import { useCallback, useRef, useState } from 'react';
import { ApiError, newIdempotencyKey } from '../../api/client.js';
import { runOrQueue } from '../../offline/syncManager.js';
import { pendingStages, stagesFromError, stagesFromSuccess } from './signingStages.js';

/*
 * Drives one signed approval. One idempotency key per approval attempt, kept for every resend, so the
 * server can never apply it twice:
 *   idle → submitting → success | failed
 *   network lost after sending → checking (resend with the SAME key: the server returns the stored
 *   result if it committed, or performs it once if it never arrived) → success | unconfirmed
 *   offline before sending → queued (the server signs it when it syncs)
 */
export function useSignedSubmit({ call, offline }) {
  const [state, setState] = useState({ phase: 'idle', stages: pendingStages(), result: null, error: null });
  const keyRef = useRef(newIdempotencyKey());
  const busyRef = useRef(false);

  const send = useCallback(
    async (checkingFirst) => {
      if (busyRef.current) return; // a second click while a request runs does nothing
      busyRef.current = true;
      try {
        // First attempt; if the connection drops before an answer, one reconcile with the SAME key.
        for (const checking of checkingFirst ? [true] : [false, true]) {
          setState({ phase: checking ? 'checking' : 'submitting', stages: pendingStages(), result: null, error: null });
          try {
            const { data } = await call(keyRef.current);
            setState({ phase: 'success', stages: stagesFromSuccess(data.signature?.stages), result: data, error: null });
            return;
          } catch (error) {
            if (!(error instanceof ApiError && error.isNetworkError)) {
              setState({ phase: 'failed', stages: stagesFromError(error), result: null, error });
              return;
            }
            if (checking) {
              setState({ phase: 'unconfirmed', stages: pendingStages(), result: null, error });
              return;
            }
          }
        }
      } finally {
        busyRef.current = false;
      }
    },
    [call],
  );

  const submit = useCallback(async () => {
    if (offline && typeof navigator !== 'undefined' && navigator.onLine === false) {
      const sent = await runOrQueue({ ...offline, key: keyRef.current }, call);
      if (sent.queued) return setState({ phase: 'queued', stages: pendingStages(), result: null, error: null });
    }
    return send(false);
  }, [offline, call, send]);

  /** Keep an unconfirmed approval on this device; the same key makes a double apply impossible. */
  const keepOffline = useCallback(async () => {
    if (!offline) return;
    await runOrQueue({ ...offline, key: keyRef.current }, () => Promise.reject(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'offline' })));
    setState((s) => ({ ...s, phase: 'queued' }));
  }, [offline]);

  /** After editing the form: a genuinely new approval gets a new key. */
  const reset = useCallback(() => {
    keyRef.current = newIdempotencyKey();
    setState({ phase: 'idle', stages: pendingStages(), result: null, error: null });
  }, []);

  return { ...state, submit, retry: () => send(false), checkAgain: () => send(true), keepOffline, reset, busy: state.phase === 'submitting' || state.phase === 'checking' };
}

// What the signing progress view shows, derived ONLY from what the server reported (pure; tested in
// signingStages.test.js). The approval is signed in one request: while it runs nothing is marked done;
// after it, every stage takes the status the server's answer proves.

export const SIGNING_STAGES = [
  { stage: 'AUTHENTICATED', label: 'Authenticating signer' },
  { stage: 'AUTHORIZED', label: 'Checking permissions' },
  { stage: 'PAYLOAD_PREPARED', label: 'Preparing approval data' },
  { stage: 'HASHED', label: 'Generating payload hash' },
  { stage: 'SIGNED', label: 'Creating RSA signature' },
  { stage: 'VERIFIED', label: 'Verifying signature' },
  { stage: 'SAVED', label: 'Saving signed approval' },
  { stage: 'CONFIRMED', label: 'Confirming result' },
];

/** While the single request is in flight: everything pending (no invented progress). */
export function pendingStages() {
  return SIGNING_STAGES.map((s) => ({ ...s, status: 'pending', detail: null }));
}

/** After success: the server's own stage list, plus "confirmed" because the answer arrived after commit. */
export function stagesFromSuccess(serverStages = []) {
  const byStage = new Map(serverStages.map((s) => [s.stage, s]));
  return SIGNING_STAGES.map((s) => {
    if (s.stage === 'CONFIRMED') return { ...s, status: 'done', detail: 'The server committed the approval and returned the verified result' };
    const reported = byStage.get(s.stage);
    return reported ? { ...s, status: reported.status === 'done' ? 'done' : 'failed', detail: reported.detail ?? null } : { ...s, status: 'unknown', detail: 'Not reported by the server' };
  });
}

/** Which stage an error stops at. The server names it for signing failures; otherwise the HTTP class does. */
export function failedStageOf(error) {
  if (error?.details?.failedStage) return error.details.failedStage;
  if (error?.status === 401) return 'AUTHENTICATED';
  if (error?.status === 403) return 'AUTHORIZED';
  if (error?.status === 400 || error?.status === 404 || error?.status === 409) return 'PAYLOAD_PREPARED';
  return 'SAVED'; // a server error: the transaction did not commit
}

const FAILURE_TEXT = {
  AUTHENTICATED: 'Your session has expired or is no longer valid. Sign in again; nothing was approved.',
  AUTHORIZED: 'Your account may not approve this record. Nothing was approved.',
  PAYLOAD_PREPARED: 'The record cannot be approved as entered, or it changed meanwhile. Nothing was approved.',
  SIGNED: 'The server could not create the signature with your signing key. Nothing was approved.',
  VERIFIED: 'Signature verification failed — approval not confirmed.',
  SAVED: 'The server could not save the approval; the database transaction was rolled back. Nothing was approved.',
};

/**
 * After a server error: stages before the failed one passed on the server (it only reaches a stage
 * after the previous ones), the failed one is marked, later ones did not run.
 */
export function stagesFromError(error) {
  const failed = failedStageOf(error);
  const index = SIGNING_STAGES.findIndex((s) => s.stage === failed);
  return SIGNING_STAGES.map((s, i) => {
    if (i < index) return { ...s, status: 'done', detail: 'Passed on the server' };
    if (i === index) return { ...s, status: 'failed', detail: error?.message ?? FAILURE_TEXT[failed] };
    return { ...s, status: 'skipped', detail: null };
  });
}

export function failureSummary(error) {
  return FAILURE_TEXT[failedStageOf(error)];
}

/** Retrying is safe only when the server did nothing for a temporary reason (same idempotency key). */
export function canRetry(error) {
  const failed = failedStageOf(error);
  return (error?.status ?? 0) >= 500 && failed !== 'VERIFIED';
}

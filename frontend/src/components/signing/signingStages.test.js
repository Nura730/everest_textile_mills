import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canRetry, failedStageOf, pendingStages, stagesFromError, stagesFromSuccess } from './signingStages.js';

const SERVER = ['AUTHENTICATED', 'AUTHORIZED', 'PAYLOAD_PREPARED', 'HASHED', 'SIGNED', 'VERIFIED', 'SAVED'].map((stage) => ({ stage, status: 'done', detail: `${stage} ok` }));

test('while the request runs, nothing is marked done', () => {
  assert.ok(pendingStages().every((s) => s.status === 'pending'));
});

test('success shows every stage the server reported, then the confirmed result', () => {
  const stages = stagesFromSuccess(SERVER);
  assert.ok(stages.every((s) => s.status === 'done'));
  assert.equal(stages.at(-1).stage, 'CONFIRMED');
  // a stage the server did not report is never shown as done
  const partial = stagesFromSuccess(SERVER.filter((s) => s.stage !== 'VERIFIED'));
  assert.equal(partial.find((s) => s.stage === 'VERIFIED').status, 'unknown');
});

test('each security-critical failure stops at its own stage and never shows success', () => {
  const cases = [
    [{ status: 401 }, 'AUTHENTICATED'],
    [{ status: 403 }, 'AUTHORIZED'],
    [{ status: 409, code: 'INVALID_STATE_TRANSITION' }, 'PAYLOAD_PREPARED'],
    [{ status: 503, code: 'SIGNING_KEY_UNAVAILABLE', details: { failedStage: 'SIGNED' } }, 'SIGNED'],
    [{ status: 500, code: 'SIGNATURE_VERIFICATION_FAILED', details: { failedStage: 'VERIFIED' } }, 'VERIFIED'],
    [{ status: 500, code: 'INTERNAL_ERROR' }, 'SAVED'],
  ];
  for (const [error, stage] of cases) {
    assert.equal(failedStageOf(error), stage);
    const stages = stagesFromError(error);
    const at = stages.findIndex((s) => s.stage === stage);
    assert.equal(stages[at].status, 'failed');
    assert.ok(stages.slice(at + 1).every((s) => s.status === 'skipped'));
    assert.notEqual(stages.at(-1).status, 'done');
  }
});

test('retry is offered only for temporary server failures, never after a failed verification', () => {
  assert.equal(canRetry({ status: 503, details: { failedStage: 'SIGNED' } }), true);
  assert.equal(canRetry({ status: 500, details: { failedStage: 'VERIFIED' } }), false);
  assert.equal(canRetry({ status: 403 }), false);
  assert.equal(canRetry({ status: 409 }), false);
});

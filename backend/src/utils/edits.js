import { AppError } from './AppError.js';

const same = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : (a ?? null) === (b ?? null));

/**
 * The fields of `requested` (stored-field names) whose value differs from `current`.
 * Returns { before, after } for the audit entry, or null when nothing would change.
 */
export function diffFields(current, requested) {
  const before = {};
  const after = {};
  for (const [field, value] of Object.entries(requested)) {
    if (value === undefined || same(current[field], value)) continue;
    before[field] = current[field] ?? null;
    after[field] = value;
  }
  return Object.keys(after).length > 0 ? { before, after } : null;
}

/** True when the client's copy (its updatedAt) is older than the stored record. */
export function isStale(record, expectedUpdatedAt) {
  return record.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime();
}

export function staleEditConflict(what) {
  return new AppError('CONFLICT', `This ${what} was changed by someone else. Reload it and try again.`, {
    details: { reason: 'STALE_EDIT' },
  });
}

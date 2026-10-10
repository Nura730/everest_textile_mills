const MUTATING_QUERIES = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];

/**
 * Mongoose plugin: documents can be created and read, never changed or removed through the model.
 * Used for records that are evidence (audit log, stock ledger, machine events, QC inspections).
 * Corrections are new records that reference the original.
 *
 * This guards the application's code paths. In production the database user would additionally
 * be granted only insert/find on these collections, so even a bug cannot rewrite history.
 */
export function appendOnly(schema, { collectionLabel }) {
  function rejectMutation() {
    throw new Error(`${collectionLabel} is append-only: entries cannot be updated or deleted`);
  }

  schema.pre(MUTATING_QUERIES, { query: true, document: false }, rejectMutation);
  schema.pre('deleteOne', { query: false, document: true }, rejectMutation);
  schema.pre('save', function rejectResave() {
    if (!this.isNew) rejectMutation();
  });
  schema.pre('bulkWrite', rejectMutation);
}

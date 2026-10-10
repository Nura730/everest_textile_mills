// Quality control (Phase 10). instruction.md §10: PASS / REWORK / REJECT with defect types.
export const QC_RESULT = Object.freeze({ PASS: 'PASS', REWORK: 'REWORK', REJECT: 'REJECT' });
export const ALL_QC_RESULTS = Object.freeze(Object.values(QC_RESULT));

// Common woven-fabric defects (assumption: the problem statement names only "colour mismatch").
export const DEFECT_TYPES = Object.freeze([
  'COLOUR_MISMATCH',
  'BROKEN_ENDS',
  'BROKEN_PICKS',
  'STAINS',
  'HOLES',
  'WIDTH_VARIATION',
  'GSM_VARIATION',
  'WEAVE_FAULT',
  'OTHER',
]);
export const DEFECT_SEVERITIES = Object.freeze(['MINOR', 'MAJOR', 'CRITICAL']);

// Digital signatures (instruction.md §11): only at high-accountability boundaries.
export const SIGNATURE_ENTITY = Object.freeze({ QC_INSPECTION: 'QC_INSPECTION', DISPATCH: 'DISPATCH' });

/** The exact sentences a signer agrees to (stored with the signature). */
export const SIGNATURE_STATEMENTS = Object.freeze({
  QC_INSPECTION: (rollNumber, result = 'PASS') =>
    ({
      PASS: `I confirm that roll ${rollNumber} has passed inspection.`,
      REWORK: `I confirm that roll ${rollNumber} needs rework for the defects recorded.`,
      REJECT: `I confirm that roll ${rollNumber} is rejected for the defects recorded.`,
    })[result],
  DISPATCH: (dispatchNumber) => `I confirm that the finished goods in dispatch ${dispatchNumber} have been dispatched.`,
});

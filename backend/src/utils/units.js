// Physical quantities are stored as integers in their smallest unit (grams, centimetres) for the
// same reason money is stored in paise: floats drift when summed, integers reconcile exactly.
// The API speaks kg and metres; conversion happens only at the edge.

const GRAMS_PER_KG = 1000;
const CM_PER_METRE = 100;

/** True when `value` has at most `places` decimal places (tolerates float representation noise). */
export function hasAtMostDecimals(value, places) {
  const scaled = value * 10 ** places;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

export function kgToGrams(kg) {
  return Math.round(kg * GRAMS_PER_KG);
}

export function gramsToKg(grams) {
  return grams / GRAMS_PER_KG;
}

export function metresToCm(metres) {
  return Math.round(metres * CM_PER_METRE);
}

export function cmToMetres(cm) {
  return cm / CM_PER_METRE;
}

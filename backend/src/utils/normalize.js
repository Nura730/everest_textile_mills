/**
 * "  navy   BLUE " → "Navy Blue". Colours are typed by people; without this, "navy blue" and
 * "Navy Blue" would be two catalog entries and two separate stock pools.
 */
export function toTitleCase(value) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_match, separator, letter) => separator + letter.toUpperCase());
}

/** Lot numbers come from supplier paperwork: trimmed, upper-cased, inner spaces removed. */
export function normalizeCode(value) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

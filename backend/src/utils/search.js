/**
 * Case-insensitive "contains" match for free-text search. The user's text is escaped, so
 * characters such as ".*" or "(" are searched literally and can never form an expensive or
 * unexpected regular expression.
 */
export function containsInsensitive(text) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

/** { $or: [{ field: /text/i }, ...] } for a search across several fields, or {} without text. */
export function searchAcross(fields, text) {
  if (!text) return {};
  const pattern = containsInsensitive(text);
  return { $or: fields.map((field) => ({ [field]: pattern })) };
}

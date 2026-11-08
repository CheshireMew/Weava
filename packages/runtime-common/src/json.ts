/** JSON comparison ignores object-key order and undefined object properties,
 * while preserving array order and JSON's treatment of undefined array items. */
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonicalJson(item)]),
    );
  }
  return value;
}
export const stableJson = (value: unknown) => JSON.stringify(canonicalJson(value));
export const equalJson = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

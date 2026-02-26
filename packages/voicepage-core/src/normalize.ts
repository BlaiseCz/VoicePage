/**
 * v1 normalization: lowercase, trim, collapse whitespace.
 */
export function normalizeLabel(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ');
}

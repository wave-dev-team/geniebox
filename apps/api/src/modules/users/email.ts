/** Canonical form used for storage, lookups and comparisons. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

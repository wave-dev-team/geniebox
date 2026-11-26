/** Up to two capital letters for an avatar fallback. */
export function initials(name: string): string {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

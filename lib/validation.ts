/**
 * Form checks shared by sign-in and the passphrase screen. Pure, so
 * scripts/verify-domain-logic.ts can test them.
 *
 * The server stays the authority (Supabase checks addresses and enforces the
 * passphrase rules in supabase/config.toml); these exist so a typo gets a
 * clear message straight away instead of a round trip, and so a mistyped
 * address does not spend one of the project's few magic-link emails.
 */

export const MIN_PASSPHRASE_LENGTH = 12;

// Deliberately permissive: one @, something before it, a dot in the domain,
// no spaces. Anything stricter starts rejecting real addresses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= 254 && EMAIL_PATTERN.test(trimmed);
}

/** Returns a sentence describing what is wrong, or null when it passes. */
export function passphraseProblem(value: string): string | null {
  if (value.length < MIN_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  }
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Include upper and lower case letters and at least one number.';
  }
  return null;
}

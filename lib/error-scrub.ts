/**
 * Removes anything personal from error text before it is reported.
 *
 * Errors can carry user content: a failed insert echoes the row, a parse error
 * quotes the input, a URL holds a token. For an app about people's sex lives
 * the rule is simple: report the shape of the failure, never its contents.
 * Pure so scripts/verify-domain-logic.ts can test it.
 */
export function scrubErrorText(text: string): string {
  return (
    text
      // Email addresses.
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      // JWTs and other long base64url tokens.
      .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[token]')
      .replace(/enc:v1:[A-Za-z0-9+/=_-]+/g, '[ciphertext]')
      .replace(/[A-Za-z0-9_-]{32,}/g, '[token]')
      // Query strings, which carry codes and tokens.
      .replace(/\?[^\s)'"]*/g, '?[query]')
      // Quoted strings, where Postgres and parsers echo input.
      .replace(/"[^"\n]{1,500}"/g, '"[value]"')
      .replace(/'[^'\n]{1,500}'/g, "'[value]'")
      // Long numbers (phone numbers, card-like sequences).
      .replace(/\b\d{7,}\b/g, '[number]')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Turns any thrown value into a sentence a person can act on.
 *
 * About 30 catch blocks used to show `err.message` as it came, so users saw
 * things like "new row violates row-level security policy for table desires"
 * or "Failed to fetch". Messages the app writes itself (RatingRequiredError,
 * describePairingError output, the reveal screen's own copy) are already
 * written for people and pass through unchanged; anything that reads like it
 * came from Postgres, PostgREST, GoTrue or the network is replaced.
 *
 * Kept free of the Supabase client so scripts/verify-domain-logic.ts can test
 * it under `node --experimental-strip-types`.
 */

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  name?: unknown;
}

function asErrorLike(err: unknown): ErrorLike {
  if (err && typeof err === 'object') return err as ErrorLike;
  if (typeof err === 'string') return { message: err };
  return {};
}

const OFFLINE =
  'We could not reach the server. Check your connection and try again.';
const SESSION =
  'Your session has expired. Sign out and sign in again to continue.';
const NOT_ALLOWED =
  'That action is not allowed for your account. If this keeps happening, sign out and back in.';
const TOO_LONG = 'That is too long. Shorten it and try again.';
const RATE_LIMITED =
  'You are doing that a little too often. Wait a few minutes and try again.';

// Fragments that only ever appear in machine-generated messages.
const TECHNICAL_PATTERNS: RegExp[] = [
  /violates/i,
  /row[- ]level security/i,
  /\bpermission denied\b/i,
  /\brelation\b.*\bdoes not exist\b/i,
  /\bcolumn\b.*\bdoes not exist\b/i,
  /\bfunction\b.*\bdoes not exist\b/i,
  /duplicate key/i,
  /\bnull value in column\b/i,
  /\bsyntax error\b/i,
  /\bPGRST\d+/,
  /\bJWT\b/i,
  /\bjwt\b/,
  /\bsqlstate\b/i,
  /\binvalid input syntax\b/i,
  /\bnetwork request failed\b/i,
  /\bfailed to fetch\b/i,
  /\bload failed\b/i,
  /\bTypeError\b/,
  /\bundefined is not\b/i,
  /\bcannot read propert/i,
  /\bunexpected token\b/i,
  /\bstatus code\b/i,
  /\bFunctionsHttpError\b/,
  /\bFunctionsFetchError\b/,
  /\bnon-2xx\b/i,
];

/**
 * @param err      anything a catch block received
 * @param fallback what to say when the error is technical and not one of the
 *                 recognised kinds; written for the screen it appears on
 */
export function friendlyError(err: unknown, fallback: string): string {
  const e = asErrorLike(err);
  const message = typeof e.message === 'string' ? e.message.trim() : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;

  if (
    /failed to fetch|network request failed|load failed|networkerror|fetch failed|FunctionsFetchError/i.test(
      message,
    ) ||
    (typeof e.name === 'string' && /FunctionsFetchError/.test(e.name))
  ) {
    return OFFLINE;
  }
  if (/jwt expired|invalid jwt|refresh token|session (has )?expired|not authenticated|authentication required/i.test(message) || code === 'PGRST301' || code === '28000') {
    return SESSION;
  }
  if (status === 429 || /rate limit|too many/i.test(message) || code === 'P0003') {
    return RATE_LIMITED;
  }
  if (code === '42501' || /row[- ]level security|permission denied/i.test(message)) {
    return NOT_ALLOWED;
  }
  if (code === '23514' && /length|char_length/i.test(message)) {
    return TOO_LONG;
  }

  if (!message) return fallback;
  if (TECHNICAL_PATTERNS.some((pattern) => pattern.test(message))) {
    return fallback;
  }
  // Postgres and PostgREST codes on an otherwise plain message still mean the
  // text was not written for people.
  if (/^[0-9A-Z]{5}$/.test(code) || code.startsWith('PGRST')) {
    return fallback;
  }
  return message;
}

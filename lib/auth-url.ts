import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * What an incoming auth URL is asking us to do, if anything.
 *
 * Three shapes reach the app, in this precedence order:
 *
 *   token_hash  the magic-link template's own form, verified with verifyOtp.
 *               Needs no PKCE verifier, so it works in any browser and on a
 *               device that did not send the request.
 *   session     implicit flow, #access_token + #refresh_token.
 *   code        PKCE, ?code=. Needs the verifier that sent the request.
 */
export type AuthUrlAction =
  | { kind: 'token_hash'; tokenHash: string; type: EmailOtpType }
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | null;

/**
 * Splits any URL into its query and fragment, without `URL`.
 *
 * `new URL()` is unreliable here: `yesyasapp:///?token_hash=x` uses a
 * non-special scheme, which Node and React Native's URL polyfill treat
 * differently, and the polyfill has historically dropped the fragment
 * entirely. Index arithmetic behaves the same everywhere and this is the one
 * code path that decides whether somebody gets signed in.
 */
function splitUrl(url: string): { search: string; hash: string } {
  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : '';
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = beforeHash.indexOf('?');
  const search = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';
  return { search, hash };
}

/**
 * Reads auth parameters out of a query string and a fragment.
 *
 * Both are checked for every parameter. Supabase has put tokens in either
 * depending on flow and platform, and the magic-link template uses the query
 * while implicit flow uses the fragment.
 */
export function parseAuthParams(parts: {
  search: string;
  hash: string;
}): AuthUrlAction {
  const search = new URLSearchParams(parts.search);
  const hash = new URLSearchParams(parts.hash.replace(/^#/, ''));

  const get = (key: string) => search.get(key) ?? hash.get(key);

  const tokenHash = get('token_hash');
  if (tokenHash) {
    return {
      kind: 'token_hash',
      tokenHash,
      type: (get('type') ?? 'email') as EmailOtpType,
    };
  }

  // Both halves are required: one without the other cannot establish a
  // session, and treating a lone access_token as success would leave the app
  // signed in with nothing to refresh.
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'session', accessToken, refreshToken };
  }

  const code = search.get('code');
  if (code) {
    return { kind: 'code', code };
  }

  return null;
}

/** As {@link parseAuthParams}, for a whole URL — including a custom scheme. */
export function parseAuthUrl(url: string | null | undefined): AuthUrlAction {
  if (!url) return null;
  return parseAuthParams(splitUrl(url));
}

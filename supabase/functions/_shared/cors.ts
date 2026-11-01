/**
 * CORS for the Edge Functions.
 *
 * Both functions used to answer `Access-Control-Allow-Origin: *`. They need a
 * bearer token, so that was not an open door, but there is no reason for any
 * other website to be able to call them from a browser. Only the app's own
 * origins are allowed; native apps send no Origin header and are unaffected.
 *
 * Extra origins (a staging domain, say) can be added without a code change:
 *   supabase secrets set ALLOWED_ORIGINS="https://staging.example.com"
 */
const DEFAULT_ALLOWED_ORIGINS = [
  'https://yesyas.vercel.app',
  'http://localhost:8081',
];

function allowedOrigins(): Set<string> {
  const extra = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra]);
}

const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

/** Wraps a handler: answers preflight and adds CORS headers to every response. */
export function withCors(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const origin = req.headers.get('Origin');
    const headers = new Headers(BASE_HEADERS);
    if (origin && allowedOrigins().has(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    const res = await handler(req);
    const merged = new Headers(res.headers);
    headers.forEach((value, key) => merged.set(key, value));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: merged });
  };
}

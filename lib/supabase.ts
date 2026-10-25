// Supabase client for YesYas!
//
// Session persistence uses AsyncStorage on native, and a light in-memory
// shim on web (SSR) to avoid "window is not defined" errors. On web in a
// real browser, Supabase falls back to localStorage automatically via the
// default storage adapter.

import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createClient,
  type EmailOtpType,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { Linking, Platform } from 'react-native';

import { type AuthUrlAction, parseAuthParams, parseAuthUrl } from './auth-url';
import type { Database } from './database.types';

// Capture the initial browser URL query & hash at module-evaluation time BEFORE
// Expo Router's root <Redirect> or router.replace('/(auth)/sign-in') strips them.
const initialWebLocation =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? {
        search: window.location.search,
        hash: window.location.hash,
      }
    : null;

let initialAuthHandled = false;

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loud in dev; in prod the app should have been built with EAS secrets.
  console.warn(
    '[YesYas] Supabase env missing. Copy .env.example to .env and fill in ' +
      'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
  );
}

// A no-op storage for server-rendered web. Supabase's own default kicks in
// when it detects a real browser window.
const memoryStorage = {
  getItem: async (_key: string) => null,
  setItem: async (_key: string, _value: string) => undefined,
  removeItem: async (_key: string) => undefined,
};

const storage =
  Platform.OS === 'web' && typeof window === 'undefined'
    ? memoryStorage
    : AsyncStorage;

export const supabase: SupabaseClient<Database> = createClient<Database>(
  url ?? 'http://invalid.local',
  anonKey ?? 'invalid',
  {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
      // PKCE on both platforms.
      //
      // Web was on implicit because PKCE breaks the common magic-link case:
      // the code verifier lives in localStorage, so a link opened in a
      // different browser than the one that requested it cannot exchange
      // ?code=. That is no longer reachable — the magic-link email template
      // (supabase/templates/magic_link.html) sends users to
      //   {{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=email
      // which consumeInitialUrlAuth consumes with verifyOtp. verifyOtp needs
      // no verifier, so it works in any browser regardless of flowType, and
      // the ?code= path is now only a fallback.
      //
      // That removes the one real cost of implicit: #access_token and
      // #refresh_token landing in the initial URL. replaceState already kept
      // them out of history, but PKCE keeps them out of the URL entirely.
      //
      // Do not set this back to implicit without first checking the email
      // template still emits {{ .TokenHash }} — the two are a pair.
      flowType: 'pkce',
    },
    global: {
      headers: {
        'x-application-name': 'yesyas-mobile',
      },
    },
  },
);

/** Applies a parsed auth action. Returns whether anything was done. */
async function applyAuthAction(action: AuthUrlAction): Promise<boolean> {
  if (!action) return false;

  if (action.kind === 'token_hash') {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: action.tokenHash,
      type: action.type,
    });
    // Older links carry a type the current template no longer sends; retry as
    // 'email' rather than stranding somebody on a valid token.
    if (error && action.type !== 'email') {
      await supabase.auth.verifyOtp({
        token_hash: action.tokenHash,
        type: 'email',
      });
    }
    return true;
  }

  if (action.kind === 'session') {
    await supabase.auth.setSession({
      access_token: action.accessToken,
      refresh_token: action.refreshToken,
    });
    return true;
  }

  await supabase.auth.exchangeCodeForSession(action.code);
  return true;
}

/** Keeps tokens out of browser history once they have been consumed. */
function clearWebAuthParams(): void {
  if (typeof window !== 'undefined' && window.history?.replaceState) {
    window.history.replaceState({}, '', window.location.pathname);
  }
}

/**
 * Processes magic-link / OTP parameters from whatever URL started the app.
 *
 * On web that is the initial browser URL, captured at module evaluation before
 * Expo Router redirects away from it. On native it is the deep link that
 * launched the app, which was previously not handled at all: this function
 * returned immediately without a window.location, detectSessionInUrl is
 * web-only, and nothing else read Linking. A magic link on a device opened the
 * app and then did nothing.
 *
 * The parsing lives in lib/auth-url.ts and is covered by
 * scripts/verify-domain-logic.ts, including the custom-scheme shapes, because
 * this is the code path that decides whether somebody gets signed in.
 */
export async function consumeInitialUrlAuth(): Promise<void> {
  if (initialAuthHandled) {
    return;
  }
  initialAuthHandled = true;

  try {
    if (initialWebLocation) {
      if (await applyAuthAction(parseAuthParams(initialWebLocation))) {
        clearWebAuthParams();
      }
      return;
    }

    if (Platform.OS !== 'web') {
      await applyAuthAction(parseAuthUrl(await Linking.getInitialURL()));
    }
  } catch (err) {
    console.warn('[YesYas] Failed to process initial auth URL:', err);
  }
}

/**
 * Handles magic links that arrive while the app is already running.
 *
 * getInitialURL only covers a cold start. On native a link tapped with the app
 * in the background delivers a 'url' event instead, and without this it would
 * be ignored — which is the more common case once somebody has the app open
 * and goes to their mail.
 *
 * Returns an unsubscribe function; no-op on web, where supabase-js and
 * consumeInitialUrlAuth already cover the entry URL.
 */
export function subscribeToAuthDeepLinks(): () => void {
  if (Platform.OS === 'web') {
    return () => {};
  }

  const subscription = Linking.addEventListener('url', ({ url }) => {
    void applyAuthAction(parseAuthUrl(url)).catch((err) => {
      console.warn('[YesYas] Failed to process auth deep link:', err);
    });
  });

  return () => {
    subscription.remove();
  };
}

/**
 * Convenience: returns the current user or throws. Use in server-side
 * Edge Functions. In React components, prefer the useSession hook.
 */
export async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Not authenticated');
  return data.user;
}

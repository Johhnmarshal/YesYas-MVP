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
import { Platform } from 'react-native';

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
      // Web uses implicit because PKCE breaks the common magic-link case: the
      // code verifier lives in localStorage, so a link opened in a different
      // browser (or an email client's in-app browser) than the one that
      // requested it cannot exchange ?code= and sign-in fails.
      //
      // consumeInitialUrlAuth() below mitigates the usual implicit objection —
      // it calls history.replaceState immediately, so the #access_token never
      // persists as a history entry. What remains is the window before that
      // runs: the token is in the initial response URL, readable by anything
      // already on the page, and browser session-restore may still hold it.
      //
      // To get back to PKCE without reintroducing the cross-browser failure,
      // both of these are needed together — changing flowType alone will break
      // sign-in again:
      //   1. Dashboard -> Authentication -> Email Templates -> Magic Link, so
      //      the link carries a token_hash instead of relying on the flow:
      //        <a href="{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=email">
      //      The token_hash branch of consumeInitialUrlAuth already handles
      //      this via verifyOtp, which needs no verifier and works anywhere.
      //   2. Then set this back to 'pkce' for both platforms.
      flowType: Platform.OS === 'web' ? 'implicit' : 'pkce',
    },
    global: {
      headers: {
        'x-application-name': 'yesyas-mobile',
      },
    },
  },
);

/**
 * Processes magic-link / OTP parameters from the initial browser URL
 * (`?token_hash=...&type=...`, `#access_token=...&refresh_token=...`, or `?code=...`)
 * before Expo Router redirects away from the entry URL.
 */
export async function consumeInitialUrlAuth(): Promise<void> {
  if (initialAuthHandled || !initialWebLocation) {
    return;
  }
  initialAuthHandled = true;

  try {
    const searchParams = new URLSearchParams(initialWebLocation.search);
    const hashRaw = initialWebLocation.hash.replace(/^#/, '');
    const hashParams = new URLSearchParams(hashRaw);

    // 1. Direct token_hash verification (works across devices & in-app browsers)
    const tokenHash =
      searchParams.get('token_hash') ?? hashParams.get('token_hash');
    const rawType = (searchParams.get('type') ??
      hashParams.get('type') ??
      'email') as EmailOtpType;

    if (tokenHash) {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: rawType,
      });
      if (error && rawType !== 'email') {
        await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'email',
        });
      }
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      return;
    }

    // 2. Implicit flow (#access_token=...&refresh_token=...)
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    if (accessToken && refreshToken) {
      await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      return;
    }

    // 3. PKCE code flow (?code=...)
    const code = searchParams.get('code');
    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  } catch (err) {
    console.warn('[YesYas] Failed to process initial auth URL:', err);
  }
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

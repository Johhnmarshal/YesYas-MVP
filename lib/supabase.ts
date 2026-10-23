// Supabase client for YesYas!
//
// Session persistence uses AsyncStorage on native, and a light in-memory
// shim on web (SSR) to avoid "window is not defined" errors. On web in a
// real browser, Supabase falls back to localStorage automatically via the
// default storage adapter.

import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import type { Database } from './database.types';

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
      flowType: 'pkce',
    },
    global: {
      headers: {
        'x-application-name': 'yesyas-mobile',
      },
    },
  },
);

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

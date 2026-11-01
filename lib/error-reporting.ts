import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { scrubErrorText } from './error-scrub';
import { supabase } from './supabase';

/**
 * First-party crash and error reporting.
 *
 * Reports go to public.client_errors (migration 20261101000001), write-only
 * from the app. Only signed-in users can report, and every message and stack
 * is scrubbed first (see lib/error-scrub.ts): email addresses, long numbers,
 * tokens and quoted strings are removed so no user content leaves the device
 * inside an error. Read the reports in the Supabase dashboard:
 *
 *   select created_at, platform, route, message from public.client_errors
 *   order by created_at desc limit 50;
 */

const MAX_PER_SESSION = 20;
let sentThisSession = 0;
let lastMessage = '';

function platformName(): 'ios' | 'android' | 'web' | null {
  if (Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web') {
    return Platform.OS;
  }
  return null;
}

function currentRoute(): string | null {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.pathname.slice(0, 200);
  }
  return null;
}

export function reportError(err: unknown, context?: string): void {
  void (async () => {
    try {
      if (sentThisSession >= MAX_PER_SESSION) return;

      const raw =
        err instanceof Error
          ? `${err.name}: ${err.message}`
          : typeof err === 'string'
            ? err
            : 'Unknown error';
      const message = scrubErrorText(context ? `[${context}] ${raw}` : raw).slice(0, 500);
      if (!message || message === lastMessage) return;

      const { data } = await supabase.auth.getSession();
      if (!data.session) return;

      sentThisSession += 1;
      lastMessage = message;

      const stack =
        err instanceof Error && err.stack ? scrubErrorText(err.stack).slice(0, 4000) : null;

      await supabase.from('client_errors').insert({
        message,
        stack,
        route: currentRoute(),
        platform: platformName(),
        app_version: (Constants.expoConfig?.version ?? '').slice(0, 40) || null,
      });
    } catch {
      // Reporting must never throw.
    }
  })();
}

let installed = false;

/** Installs global handlers once: uncaught errors and unhandled rejections. */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    window.addEventListener('error', (event) => {
      reportError(event.error ?? event.message, 'window.onerror');
    });
    window.addEventListener('unhandledrejection', (event) => {
      reportError(event.reason, 'unhandledrejection');
    });
    return;
  }

  const globalWithErrorUtils = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    };
  };
  const errorUtils = globalWithErrorUtils.ErrorUtils;
  if (!errorUtils) return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    reportError(error, isFatal ? 'fatal' : 'global');
    previous(error, isFatal);
  });
}

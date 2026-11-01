import { Platform } from 'react-native';

import { supabase } from './supabase';

/**
 * First-party, content-free product analytics.
 *
 * Events go to public.analytics_events (migration 20261101000001), a
 * write-only table: the app can insert its own rows and read none. Only an
 * event name from the fixed list below and the platform are stored, never a
 * rating, note, comment, journal text, item id or partner id. Third-party
 * analytics would put a vendor between the user and data about their sex life;
 * this keeps the funnel measurable without that.
 *
 * Fire and forget: tracking never throws and never delays the UI.
 */
export type AnalyticsEvent =
  | 'signed_in'
  | 'consent_given'
  | 'onboarding_completed'
  | 'rating_saved'
  | 'invite_created'
  | 'pairing_accepted'
  | 'reveal_ready'
  | 'reveal_viewed'
  | 'journal_entry_saved'
  | 'account_deleted_requested';

function platformName(): 'ios' | 'android' | 'web' | null {
  if (Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web') {
    return Platform.OS;
  }
  return null;
}

export function track(event: AnalyticsEvent): void {
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      await supabase
        .from('analytics_events')
        .insert({ event, platform: platformName() });
    } catch {
      // Analytics must never break the app.
    }
  })();
}

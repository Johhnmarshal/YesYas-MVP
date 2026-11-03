import { supabase } from './supabase';

/**
 * Asks the `notify` Edge Function to deliver any reveal nudges queued for
 * this user's pairing (see migration 20261103000001).
 *
 * The database decides what to send; this only prompts delivery, so it is
 * safe to call often. It is fire-and-forget: a failure here must never get in
 * the way of tapping ready or loading Home, and anything not delivered stays
 * queued for the next call.
 */
let lastPing = 0;
const MIN_INTERVAL_MS = 30_000;

export function pingNotify(): void {
  const now = Date.now();
  if (now - lastPing < MIN_INTERVAL_MS) return;
  lastPing = now;
  void supabase.functions
    .invoke('notify', { body: {} })
    .catch(() => undefined);
}

/** Bypasses the throttle; for the moment someone has just tapped ready. */
export function pingNotifyNow(): void {
  lastPing = 0;
  pingNotify();
}

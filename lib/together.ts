/**
 * The small "we are doing this together" signals: nudges and the shared
 * progress meter (migration 20261111000001). Neither carries an answer.
 */
import { supabase } from './supabase';
import { pingNotifyNow } from './notifications';

export interface NudgeRow {
  id: string;
  pairing_id: string;
  sender_id: string;
  recipient_id: string;
  created_at: string;
}

export class NudgeCooldownError extends Error {
  constructor() {
    super('You already sent a nudge recently. You can send another in a few hours.');
    this.name = 'NudgeCooldownError';
  }
}

export async function sendNudge(pairingId: string): Promise<string> {
  const { data, error } = await supabase.rpc('send_nudge', { p_pairing_id: pairingId });
  if (error) {
    if (error.code === 'P0004') throw new NudgeCooldownError();
    throw error;
  }
  pingNotifyNow();
  return data;
}

/** Nudges sent or received in the pairing over the last day, newest first. */
export async function fetchRecentNudges(pairingId: string): Promise<NudgeRow[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('partner_nudges')
    .select('id, pairing_id, sender_id, recipient_id, created_at')
    .eq('pairing_id', pairingId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []) as NudgeRow[];
}

export async function fetchSharedProgress(
  pairingId: string,
): Promise<{ together: number; total: number } | null> {
  const { data, error } = await supabase.rpc('get_shared_progress', { p_pairing_id: pairingId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return row ? { together: row.explored_together, total: row.total } : null;
}

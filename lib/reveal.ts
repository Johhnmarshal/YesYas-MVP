import type { Database, RevealStatus } from './database.types';
import { supabase } from './supabase';

export type RevealRow = Database['public']['Tables']['reveals']['Row'];

export interface CuriosityBridgeScript {
  id: string;
  title: string;
  prompt: string;
  tip: string;
}

export const CURIOSITY_BRIDGE_SCRIPTS: CuriosityBridgeScript[] = [
  {
    id: 'curiosity-check-in',
    title: 'Low-pressure curiosity check-in',
    prompt:
      '"One of us felt drawn to this and the other felt open to exploring. What part of this idea feels comfortable to you, and what part feels like a stretch?"',
    tip: 'Remember: neither of you rated this a 1 or 2. Both of you are at least open to the conversation.',
  },
  {
    id: 'smaller-first-step',
    title: 'Find the smallest warm step',
    prompt:
      '"If we took the most gentle, zero-expectation version of this idea, what would that look like for us?"',
    tip: 'Focus on sensory comfort and clear boundaries rather than a predetermined outcome.',
  },
  {
    id: 'appreciate-and-park',
    title: 'Appreciate and park for later',
    prompt:
      '"I love knowing this is in our curiosity zone. Let’s keep it on our radar without needing to act on it tonight."',
    tip: 'Parking an idea with warmth builds safety and makes future reveals feel even lighter.',
  },
];

export async function fetchCurrentReveal(pairingId: string): Promise<RevealRow | null> {
  try {
    await supabase.rpc('expire_old_reveals');
  } catch {
    // Non-fatal if RPC is unavailable offline
  }

  const { data, error } = await supabase
    .from('reveals')
    .select('*')
    .eq('pairing_id', pairingId)
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

/** Standard cadence from trigger_reveal(): one computed reveal per pairing per week. */
export const REVEAL_CADENCE_DAYS = 7;

/**
 * When this pairing may compute its next reveal, or null if it may now.
 *
 * The reveal screen needs this because the two timers differ: items clear
 * after 24 hours, but the cadence runs for 7 days. Between those the screen
 * shows an expired reveal while the server will still refuse a new one.
 */
export function nextRevealAvailableAt(reveal: RevealRow | null): Date | null {
  if (!reveal?.revealed_at || reveal.status === 'pending') return null;
  const next = new Date(
    new Date(reveal.revealed_at).getTime() + REVEAL_CADENCE_DAYS * 24 * 60 * 60 * 1000,
  );
  return next.getTime() > Date.now() ? next : null;
}

/** True for the P0001 trigger_reveal raises when the weekly cadence blocks a reveal. */
export function isCadenceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return message.toLowerCase().includes('reveal cadence limit');
}

/**
 * Minimum ratings in the current pairing before trigger_reveal will accept a
 * readiness tap. Mirrors the P0002 guard in 20261025000004; keep the two in
 * step. The screen uses this to disable the button rather than let the server
 * refuse, because the refusal is the only feedback a tester would otherwise
 * get and a reveal spends the weekly slot.
 */
export const MIN_RATINGS_FOR_REVEAL = 3;

/** True for the P0002 trigger_reveal raises when the caller has rated too little. */
export function isTooFewRatingsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return message.toLowerCase().includes('rate at least');
}

export async function triggerReveal(
  pairingId: string,
): Promise<{ reveal_id: string; status: RevealStatus }> {
  const { data, error } = await supabase.rpc('trigger_reveal', {
    p_pairing_id: pairingId,
  });
  if (error) {
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error('Failed to trigger reveal');
  }
  return row;
}

export async function fetchPairReveals(pairingId: string): Promise<RevealRow[]> {
  const { data, error } = await supabase
    .from('reveals')
    .select('*')
    .eq('pairing_id', pairingId)
    .order('triggered_at', { ascending: false });

  if (error) {
    throw error;
  }
  return data ?? [];
}

export async function withdrawReveal(pairingId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_reveal', {
    p_pairing_id: pairingId,
  });
  if (error) {
    throw error;
  }
}

export async function requestTherapistExport(
  pairingId: string,
): Promise<{ both_consented: boolean; export_event_id: string }> {
  const { data, error } = await supabase.rpc('request_therapist_export', {
    p_pairing_id: pairingId,
  });
  if (error) {
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error('Failed to record therapist export consent');
  }
  return row;
}

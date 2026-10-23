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

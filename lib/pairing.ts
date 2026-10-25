import type { Database, PairingStatus } from './database.types';
import { supabase } from './supabase';

export type PairingRow = Database['public']['Tables']['pairings']['Row'];

export interface PairingInviteResult {
  pairing_id: string;
  invite_code: string;
  expires_at: string;
}

export interface PairingInvitePreview {
  pairing_id: string;
  inviter_display_name: string;
  expires_at: string;
}

export interface PairingWithPartner extends PairingRow {
  partner_user_id: string | null;
  partner_display_name: string | null;
}

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Turns the exceptions accept_pairing_invite raises into something a person
 * can act on.
 *
 * The RPC's messages are written for a log: lowercase, terse, phrased from
 * the database's point of view ('inviter cannot accept own invite'). Every
 * one of these is a situation a real couple hits — clicking your own share
 * link, an invite left for three days, trying to pair while already paired —
 * so each needs to say what happened and what to do next.
 */
export function describePairingError(err: unknown, fallback: string): string {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();

  if (raw.includes('inviter cannot accept own invite')) {
    return 'This is your own invite link. Send it to your partner and ask them to open it on their device.';
  }
  if (raw.includes('already has an active pairing')) {
    return 'One of you is already paired with someone. End that pairing in Settings before starting a new one.';
  }
  if (raw.includes('has expired') || raw.includes('invalid or expired')) {
    return 'This invite has expired — they only last 48 hours. Ask your partner to send a fresh one.';
  }
  if (raw.includes('authentication required')) {
    return 'Your session has ended. Sign in again and reopen the invite.';
  }
  if (raw.includes('invite code is required')) {
    return 'Enter the 8-character code from your partner’s invite.';
  }
  if (raw.includes('failed to generate unique invite code')) {
    return 'Could not create an invite just now. Please try again.';
  }
  if (raw.includes('not a member of this pairing')) {
    return 'You are no longer part of this pairing.';
  }
  if (raw.includes('cannot transition an ended pairing')) {
    return 'This pairing has already ended. Start a new invite to pair again.';
  }
  if (raw.includes('pending pairing can only be cancelled')) {
    return 'This invite has not been accepted yet — you can cancel it, but not pause or resume it.';
  }
  if (raw.includes('invalid target pairing status')) {
    return 'That change is not available for this pairing.';
  }
  return fallback;
}

export async function createPairingInvite(): Promise<PairingInviteResult> {
  const { data, error } = await supabase.rpc('create_pairing_invite');
  if (error) {
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error('Failed to create pairing invite');
  }
  return row;
}

export async function previewPairingInvite(code: string): Promise<PairingInvitePreview | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  const { data, error } = await supabase.rpc('preview_pairing_invite', {
    p_invite_code: normalized,
  });
  if (error) {
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? null;
}

export async function acceptPairingInvite(code: string): Promise<string> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) {
    throw new Error('Invite code is required');
  }
  const { data, error } = await supabase.rpc('accept_pairing_invite', {
    p_invite_code: normalized,
  });
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error('Failed to accept pairing invite');
  }
  return data;
}

export async function updatePairingStatus(
  pairingId: string,
  status: PairingStatus,
): Promise<void> {
  const { error } = await supabase.rpc('update_pairing_status', {
    p_pairing_id: pairingId,
    p_new_status: status,
  });
  if (error) {
    throw error;
  }
}

export async function getActiveOrPendingPairing(
  userId: string,
): Promise<PairingWithPartner | null> {
  if (!userId || !UUID_REGEX.test(userId)) {
    return null;
  }
  const { data, error } = await supabase
    .from('pairings')
    .select('*')
    .or(`inviter_user_id.eq.${userId},invitee_user_id.eq.${userId}`)
    .in('status', ['active', 'paused', 'pending'])
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }
  if (!data || data.length === 0) {
    return null;
  }

  const nowMs = Date.now();
  const activeOrPaused = data.find((p) => p.status === 'active' || p.status === 'paused');
  const pendingValid = data.find(
    (p) =>
      p.status === 'pending' &&
      (!p.invite_expires_at || new Date(p.invite_expires_at).getTime() > nowMs),
  );

  const chosen = activeOrPaused ?? pendingValid ?? null;
  if (!chosen) {
    return null;
  }

  const partnerUserId =
    chosen.inviter_user_id === userId ? chosen.invitee_user_id : chosen.inviter_user_id;

  let partnerDisplayName: string | null = null;
  if (partnerUserId) {
    const { data: partnerProfile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', partnerUserId)
      .maybeSingle();
    partnerDisplayName = partnerProfile?.display_name ?? null;
  }

  return {
    ...chosen,
    partner_user_id: partnerUserId,
    partner_display_name: partnerDisplayName,
  };
}

export async function fetchActivePairings(
  userId: string,
): Promise<PairingWithPartner[]> {
  if (!userId || !UUID_REGEX.test(userId)) {
    return [];
  }
  const { data, error } = await supabase
    .from('pairings')
    .select('*')
    .or(`inviter_user_id.eq.${userId},invitee_user_id.eq.${userId}`)
    .in('status', ['active', 'paused'])
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }
  if (!data) return [];

  return Promise.all(
    data.map(async (row) => {
      const partnerUserId =
        row.inviter_user_id === userId ? row.invitee_user_id : row.inviter_user_id;
      let partnerDisplayName: string | null = null;
      if (partnerUserId) {
        const { data: partnerProfile } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', partnerUserId)
          .maybeSingle();
        partnerDisplayName = partnerProfile?.display_name ?? null;
      }
      return {
        ...row,
        partner_user_id: partnerUserId,
        partner_display_name: partnerDisplayName,
      };
    }),
  );
}

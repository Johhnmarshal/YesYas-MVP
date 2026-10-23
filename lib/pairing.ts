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

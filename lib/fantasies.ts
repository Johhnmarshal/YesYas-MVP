/**
 * Fantasy Vault data (migration 20261112000001).
 *
 * Private fantasies are encrypted on this device like journal entries. A
 * card sent to a partner is a separate plain-text copy that only the
 * card functions can read; see lib/fantasy-rules.ts for what the app tells
 * people about that before they send.
 */
import { classifyDecryptionFailure, decryptText, encryptText, type EncryptedFieldState } from './crypto';
import { FANTASY_MAX_LENGTH, cardProblem } from './fantasy-rules';
import { pingNotifyNow } from './notifications';
import { supabase } from './supabase';

export interface Fantasy {
  id: string;
  body: string;
  bodyState: EncryptedFieldState;
  created_at: string;
}

export interface FantasyCard {
  id: string;
  direction: 'sent' | 'received';
  body: string;
  created_at: string;
  my_response: number | null;
  is_yes: boolean;
}

export class FantasyCardLimitError extends Error {
  constructor() {
    super('You have sent three cards today. Save this one and send it tomorrow.');
    this.name = 'FantasyCardLimitError';
  }
}

export async function fetchFantasies(userId: string): Promise<Fantasy[]> {
  const { data, error } = await supabase
    .from('fantasies')
    .select('id, body, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return Promise.all(
    (data ?? []).map(async (row) => {
      try {
        return { ...row, body: await decryptText(row.body, userId), bodyState: 'ok' as const };
      } catch (err) {
        return { ...row, body: '', bodyState: classifyDecryptionFailure(err) };
      }
    }),
  );
}

export async function saveFantasy(userId: string, body: string): Promise<Fantasy> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Write something first.');
  if (trimmed.length > FANTASY_MAX_LENGTH) {
    throw new Error(`Keep a fantasy under ${FANTASY_MAX_LENGTH.toLocaleString('en-GB')} characters.`);
  }
  const cipher = await encryptText(trimmed, userId);
  const { data, error } = await supabase
    .from('fantasies')
    .insert({ user_id: userId, body: cipher })
    .select('id, created_at')
    .single();
  if (error) throw error;
  return { id: data.id, created_at: data.created_at, body: trimmed, bodyState: 'ok' };
}

export async function deleteFantasy(userId: string, id: string): Promise<void> {
  const { error } = await supabase.from('fantasies').delete().eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

export async function sendFantasyCard(pairingId: string, body: string): Promise<string> {
  const problem = cardProblem(body);
  if (problem) throw new Error(problem);
  const { data, error } = await supabase.rpc('send_fantasy_card', {
    p_pairing_id: pairingId,
    p_body: body.trim(),
  });
  if (error) {
    if (error.code === 'P0004') throw new FantasyCardLimitError();
    throw error;
  }
  pingNotifyNow();
  return data;
}

export async function fetchFantasyCards(pairingId: string): Promise<FantasyCard[]> {
  const { data, error } = await supabase.rpc('list_fantasy_cards', { p_pairing_id: pairingId });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...r,
    direction: r.direction === 'sent' ? 'sent' : 'received',
    is_yes: r.is_yes === true,
  }));
}

export async function answerFantasyCard(cardId: string, rating: number): Promise<void> {
  const { error } = await supabase.rpc('answer_fantasy_card', { p_card_id: cardId, p_rating: rating });
  if (error) throw error;
}

export async function reportFantasyCard(cardId: string, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc('report_fantasy_card', { p_card_id: cardId, p_reason: reason ?? '' });
  if (error) throw error;
}

export async function withdrawFantasyCard(cardId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_fantasy_card', { p_card_id: cardId });
  if (error) throw error;
}

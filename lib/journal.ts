import { decryptText, encryptText, sha256Hex } from './crypto';
import type { Database } from './database.types';
import { supabase } from './supabase';

export type JournalEntryRow = Database['public']['Tables']['journal_entries']['Row'];

export interface AiCoachResponse {
  reply: string;
  threadId: string;
  isFallback?: boolean;
}

const REFLECTIVE_PROMPTS: string[] = [
  'What part of that reflection feels most grounding or energizing to you right now?',
  'When you notice that feeling, what helps you feel most at ease and unhurried with yourself?',
  'If there were zero pressure to act on or explain this, how would you describe what matters most to you about it?',
  'What would make exploring this thought feel a little safer or more comfortable over the next week?',
];

function generateDeterministicThreadId(seed: string): string {
  const hex = sha256Hex(`${seed}:${Date.now()}:${Math.random()}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function buildLocalReflectiveReply(message: string, threadId?: string): AiCoachResponse {
  const hash = sha256Hex(message.trim().toLowerCase());
  const index = parseInt(hash.slice(0, 2), 16) % REFLECTIVE_PROMPTS.length;
  return {
    reply: `Thank you for putting that into words in your private space. ${REFLECTIVE_PROMPTS[index]}`,
    threadId: threadId ?? generateDeterministicThreadId(message),
    isFallback: true,
  };
}

export async function fetchJournalEntries(userId: string): Promise<JournalEntryRow[]> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = data ?? [];
  return Promise.all(
    rows.map(async (row) => {
      try {
        const decryptedBody = await decryptText(row.body, userId);
        return { ...row, body: decryptedBody };
      } catch {
        return { ...row, body: '[Unable to decrypt entry on this device]' };
      }
    }),
  );
}

export async function fetchJournalEntryById(
  userId: string,
  entryId: string,
): Promise<JournalEntryRow | null> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('id', entryId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  try {
    const decryptedBody = await decryptText(data.body, userId);
    return { ...data, body: decryptedBody };
  } catch {
    return { ...data, body: '[Unable to decrypt entry on this device]' };
  }
}

export async function createJournalEntry(
  userId: string,
  body: string,
  threadId?: string | null,
): Promise<JournalEntryRow> {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error('Journal entry cannot be empty');
  }

  const encryptedBody = await encryptText(trimmed, userId);
  const { data, error } = await supabase
    .from('journal_entries')
    .insert({
      user_id: userId,
      body: encryptedBody,
      ai_coach_thread_id: threadId ?? null,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return {
    ...data,
    body: trimmed,
  };
}

export async function sendAiCoachMessage(
  message: string,
  threadId?: string,
): Promise<AiCoachResponse> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('Message cannot be empty');
  }

  try {
    const { data, error } = await supabase.functions.invoke('ai-coach', {
      body: {
        message: trimmed,
        threadId: threadId ?? null,
      },
    });

    if (error || !data || typeof data.reply !== 'string') {
      return buildLocalReflectiveReply(trimmed, threadId);
    }

    return {
      reply: data.reply,
      threadId:
        typeof data.threadId === 'string' && data.threadId
          ? data.threadId
          : (threadId ?? generateDeterministicThreadId(trimmed)),
      isFallback: false,
    };
  } catch {
    return buildLocalReflectiveReply(trimmed, threadId);
  }
}

export async function reportAiMessage(
  userId: string,
  journalEntryId: string | null,
  reason: string,
): Promise<void> {
  const trimmedReason = reason.trim() || 'user_reported';
  const { error } = await supabase.from('ai_flags').insert({
    user_id: userId,
    journal_entry_id: journalEntryId || null,
    reason: trimmedReason,
  });

  if (error) {
    throw error;
  }
}

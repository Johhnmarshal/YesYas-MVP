import {
  classifyDecryptionFailure,
  decryptText,
  encryptText,
  sha256Hex,
  type EncryptedFieldState,
} from './crypto';
import type { Database } from './database.types';
import { supabase } from './supabase';

export type JournalEntryRow = Database['public']['Tables']['journal_entries']['Row'];

/**
 * A journal entry plus whether its body could be read on this device.
 *
 * `bodyState` replaces the old practice of putting a human-readable sentinel
 * into `body`, which the UI could not tell apart from something the user had
 * actually written. When it is not `ok`, `body` is empty and the caller is
 * expected to render a locked state instead of the text.
 */
export interface JournalEntryWithBody extends JournalEntryRow {
  bodyState: EncryptedFieldState;
}

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

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function generateDeterministicThreadId(seed: string): string {
  const hex = sha256Hex(`${seed}:${Date.now()}:${Math.random()}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function buildLocalReflectiveReply(message: string, threadId?: string): AiCoachResponse {
  const hash = sha256Hex(message.trim().toLowerCase());
  const index = parseInt(hash.slice(0, 2), 16) % REFLECTIVE_PROMPTS.length;
  const validThreadId =
    typeof threadId === 'string' && UUID_REGEX.test(threadId)
      ? threadId
      : generateDeterministicThreadId(message);
  return {
    reply: `Thank you for putting that into words in your private space. ${REFLECTIVE_PROMPTS[index]}`,
    threadId: validThreadId,
    isFallback: true,
  };
}

export async function fetchJournalEntries(
  userId: string,
): Promise<JournalEntryWithBody[]> {
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
        return { ...row, body: await decryptText(row.body, userId), bodyState: 'ok' };
      } catch (err) {
        // The ciphertext stays in the database untouched; a recovery-code
        // unlock brings it back.
        return { ...row, body: '', bodyState: classifyDecryptionFailure(err) };
      }
    }),
  );
}

export async function fetchJournalEntryById(
  userId: string,
  entryId: string,
): Promise<JournalEntryWithBody | null> {
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
    return { ...data, body: await decryptText(data.body, userId), bodyState: 'ok' };
  } catch (err) {
    return { ...data, body: '', bodyState: classifyDecryptionFailure(err) };
  }
}

export async function createJournalEntry(
  userId: string,
  body: string,
  threadId?: string | null,
): Promise<JournalEntryWithBody> {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error('Journal entry cannot be empty');
  }

  const validThreadId =
    typeof threadId === 'string' && UUID_REGEX.test(threadId)
      ? threadId
      : null;

  const encryptedBody = await encryptText(trimmed, userId);
  const { data, error } = await supabase
    .from('journal_entries')
    .insert({
      user_id: userId,
      body: encryptedBody,
      ai_coach_thread_id: validThreadId,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return {
    ...data,
    body: trimmed,
    bodyState: 'ok',
  };
}

export const saveJournalEntry = createJournalEntry;

export async function deleteJournalEntry(
  userId: string,
  entryId: string,
): Promise<void> {
  const { error } = await supabase
    .from('journal_entries')
    .delete()
    .eq('id', entryId)
    .eq('user_id', userId);

  if (error) {
    throw error;
  }
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
    const sanitizedThreadId =
      typeof threadId === 'string' && UUID_REGEX.test(threadId)
        ? threadId
        : null;

    const { data, error } = await supabase.functions.invoke('ai-coach', {
      body: {
        message: trimmed,
        threadId: sanitizedThreadId,
      },
    });

    if (error || !data || typeof data.reply !== 'string') {
      return buildLocalReflectiveReply(trimmed, sanitizedThreadId ?? undefined);
    }

    const returnedThreadId =
      typeof data.threadId === 'string' && UUID_REGEX.test(data.threadId)
        ? data.threadId
        : (sanitizedThreadId ?? generateDeterministicThreadId(trimmed));

    return {
      reply: data.reply,
      threadId: returnedThreadId,
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

/**
 * Groups journal rows into conversations for the Past Reflections list.
 *
 * Pure (no Supabase import) so scripts/verify-domain-logic.ts can test it.
 *
 * Before migration 20261103000002 a coach reply was saved exactly like
 * something the person wrote, and the list showed every row newest first, so
 * a reply appeared above the reflection it answered and looked like the
 * person's own words. Rows now carry an author; rows from before that are
 * recognised by the one sentence every built-in reply started with.
 */

export type JournalAuthor = 'user' | 'coach';

export interface ThreadableEntry {
  id: string;
  created_at: string;
  ai_coach_thread_id: string | null;
  author?: JournalAuthor | null;
  body: string;
  bodyState: string;
}

export interface JournalThread<T extends ThreadableEntry = ThreadableEntry> {
  key: string;
  /** Oldest first: the reflection, then the replies to it. */
  entries: T[];
  startedAt: string;
  lastActivityAt: string;
}

/** The opening every built-in (non-AI) coach reply used. */
export const LEGACY_COACH_PREFIX =
  'Thank you for putting that into words in your private space.';

export function entryAuthor(entry: ThreadableEntry): JournalAuthor {
  if (entry.author === 'coach') return 'coach';
  if (entry.bodyState === 'ok' && entry.body.startsWith(LEGACY_COACH_PREFIX)) {
    return 'coach';
  }
  return 'user';
}

export function groupJournalThreads<T extends ThreadableEntry>(
  entries: readonly T[],
): JournalThread<T>[] {
  const byKey = new Map<string, T[]>();
  for (const entry of entries) {
    const key = entry.ai_coach_thread_id ?? `entry:${entry.id}`;
    const list = byKey.get(key);
    if (list) list.push(entry);
    else byKey.set(key, [entry]);
  }

  const threads: JournalThread<T>[] = [];
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => {
      const t = a.created_at.localeCompare(b.created_at);
      if (t !== 0) return t;
      // Same timestamp (saved in one go): the person's words come first.
      return (entryAuthor(a) === 'user' ? 0 : 1) - (entryAuthor(b) === 'user' ? 0 : 1);
    });
    threads.push({
      key,
      entries: sorted,
      startedAt: sorted[0].created_at,
      lastActivityAt: sorted[sorted.length - 1].created_at,
    });
  }

  return threads.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

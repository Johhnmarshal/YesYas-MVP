import type { Database } from './database.types';

type RevealRow = Database['public']['Tables']['reveals']['Row'];

/** Fields the time-based predicates below actually read. */
export type RevealTiming = Pick<
  RevealRow,
  'status' | 'triggered_at' | 'revealed_at' | 'expires_at'
>;

/** Both partners must mark ready inside this window or the attempt lapses. */
export const REVEAL_READINESS_WINDOW_HOURS = 72;

/** How long a computed reveal's items stay readable. */
export const REVEAL_VISIBILITY_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Whether a computed reveal's items should still be shown.
 *
 * This has to be decided on the client as well as the server. `expire_old_reveals`
 * is scheduled every 15 minutes (migration 20261025000001), which is a
 * deliberate tolerance on a privacy deadline rather than a bug — but it means a
 * row can sit at status 'computed' with `expires_at` already in the past.
 *
 * The reveal screen already did this check inline and so was correct. The home
 * screen did not, and announced "Active reveal: N mutual matches" for up to a
 * quarter of an hour after the reveal screen had started calling it expired.
 * Two screens disagreeing about whether a privacy deadline has passed is the
 * kind of thing that makes people stop believing the deadline.
 *
 * The match count itself is designed to outlive the items — "you had 7
 * matches" persists while the list disappears — so this governs the wording and
 * the items, not the summary.
 */
export function isRevealContentExpired(
  reveal: RevealTiming | null,
  nowMs: number,
): boolean {
  if (!reveal) return false;
  if (reveal.status === 'expired') return true;
  if (reveal.status !== 'computed') return false;

  const expiresAt = reveal.expires_at
    ? new Date(reveal.expires_at).getTime()
    : new Date(reveal.revealed_at ?? reveal.triggered_at).getTime() +
      REVEAL_VISIBILITY_HOURS * HOUR_MS;

  return expiresAt <= nowMs;
}

/**
 * Whether a pending reveal's 72-hour readiness window has lapsed.
 *
 * Nothing on the server closes this window — a pending row simply stays
 * pending — so a client that does not check it tells the user they are still
 * "waiting for your partner to tap ready" indefinitely, days after the attempt
 * went stale. The reveal screen checked it; the home screen did not.
 */
export function isReadinessWindowClosed(
  reveal: RevealTiming | null,
  nowMs: number,
): boolean {
  if (!reveal || reveal.status !== 'pending') return false;
  const windowEnd =
    new Date(reveal.triggered_at).getTime() +
    REVEAL_READINESS_WINDOW_HOURS * HOUR_MS;
  return windowEnd <= nowMs;
}

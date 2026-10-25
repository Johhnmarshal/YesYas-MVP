/**
 * Turns a pairing RPC exception into a sentence a user can act on.
 *
 * Kept apart from lib/pairing.ts, which imports the Supabase client and so
 * cannot be loaded under `node --experimental-strip-types`. This is a pure
 * string mapper with a dozen branches and it is the last thing between a
 * tester and a raw Postgres error, so it belongs somewhere a test can reach —
 * the same reason lib/library-filter.ts and lib/reveal-state.ts exist.
 */
export function describePairingError(err: unknown, fallback: string): string {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();

  if (raw.includes('inviter cannot accept own invite')) {
    return 'This is your own invite link. Send it to your partner and ask them to open it on their device.';
  }
  if (raw.includes('already has an active pairing')) {
    return 'One of you is already paired with someone. End that pairing in Settings before starting a new one.';
  }
  // The same rule, enforced by the database rather than by an RPC check.
  //
  // pairings_one_active_inviter and pairings_one_active_invitee are partial
  // unique indexes on status = 'active'. The RPCs check for an existing active
  // pairing before creating or accepting one, but update_pairing_status does
  // not — so resuming a paused pairing while another is active reaches the
  // index instead of a check, and raises 23505. Measured on the hosted
  // project: pause with one partner, pair with another, resume the first, and
  // the user was shown
  //
  //   duplicate key value violates unique constraint
  //   "pairings_one_active_inviter"
  //
  // which is a real sequence a beta tester can walk into. The invariant held —
  // that index is doing exactly its job — only the wording was unusable.
  if (
    raw.includes('pairings_one_active') ||
    (raw.includes('duplicate key') && raw.includes('pairings'))
  ) {
    return 'You already have another active pairing. End or pause that one first, then resume this one.';
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

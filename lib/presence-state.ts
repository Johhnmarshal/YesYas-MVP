/**
 * Presence helpers (pure, so scripts/verify-domain-logic.ts can test them).
 *
 * The payload each person publishes is deliberately tiny: where in the app
 * they are, at the coarsest useful level. Never what they are looking at.
 */
export type PresenceWhere = 'library' | 'app';

export interface PresencePayload {
  user_id: string;
  where: PresenceWhere;
}

export function presenceTopic(pairingId: string): string {
  return `pairing:${pairingId}`;
}

export function presenceWhere(pathname: string): PresenceWhere {
  return /^\/library(\/|$)/.test(pathname) ? 'library' : 'app';
}

/**
 * The partner's entry in a Supabase presenceState() result, or null when
 * they are not connected. Takes the most useful of several tabs: library
 * wins over app.
 */
export function partnerPresenceFrom(
  state: Record<string, unknown[]>,
  partnerId: string,
): PresenceWhere | null {
  let found: PresenceWhere | null = null;
  for (const entries of Object.values(state)) {
    for (const raw of entries) {
      const e = raw as Partial<PresencePayload>;
      if (e?.user_id !== partnerId) continue;
      if (e.where === 'library') return 'library';
      found = 'app';
    }
  }
  return found;
}

export const AVATARS: readonly string[] = ['🦊', '🐻', '🐱', '🦋', '🌙', '🔥', '🌹', '🍑', '🍒', '✨', '💜', '🌊'];

export function heatLabel(tier: string | null): string | null {
  if (tier === 'sensory') return 'Sensory';
  if (tier === 'suggestive') return 'Suggestive';
  if (tier === 'explicit') return 'Explicit';
  return null;
}

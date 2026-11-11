/**
 * Fantasy Vault rules and copy that have to stay honest.
 *
 * Pure (no React or Supabase import) so scripts/verify-domain-logic.ts can
 * check it. The server enforces the same limits (20261112000001).
 */

/** Matches the check on public.fantasy_cards.body. */
export const FANTASY_CARD_MAX_LENGTH = 600;
/** Private fantasies are encrypted; this is the plaintext cap. */
export const FANTASY_MAX_LENGTH = 4000;
/** send_fantasy_card allows this many per 24 hours. */
export const FANTASY_CARDS_PER_DAY = 3;

export const FANTASY_CONTENT_RULES: readonly string[] = [
  'Adults only, and only the two of you. No real people besides you two.',
  'Consent always. Nothing that harms anyone or breaks the law.',
  'Your partner can report a card. Reported cards are hidden from them and kept for review.',
];

/**
 * What the author is told before sending. Every line is a fact about how the
 * feature works, so none of it may be softened into something untrue.
 */
export function sendDisclosure(partnerName: string): string[] {
  return [
    `${partnerName} will see that this came from you.`,
    `${partnerName} rates it 1 to 5. You only find out if it is a 4 or 5; anything lower stays with ${partnerName}.`,
    'Shared cards are stored on our server so your partner can read them. Unlike your private fantasies, they are not end-to-end encrypted.',
  ];
}

/** Why a draft cannot be sent as a card, or null when it can. */
export function cardProblem(text: string): string | null {
  const t = text.trim();
  if (!t) return 'Write something first.';
  if (t.length > FANTASY_CARD_MAX_LENGTH) {
    return `A card is up to ${FANTASY_CARD_MAX_LENGTH} characters. Trim it, or send the heart of it.`;
  }
  return null;
}

/**
 * The author's view of a sent card. Deliberately two states: "no yes yet"
 * covers unanswered, a low answer and a report alike, so none can be told
 * apart.
 */
export function sentCardStatus(isYes: boolean, partnerName: string): string {
  return isYes ? `${partnerName} said yes` : 'Sent. You will see here if it is a yes.';
}

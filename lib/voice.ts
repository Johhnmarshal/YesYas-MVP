/**
 * How the app talks, per person.
 *
 * Testers said the app read as "PG and prudish": it called sex "this", asked
 * "How do you like to talk about this?" and labelled ratings like an intake
 * form. Everyone already picks a tone at onboarding (romantic, playful or
 * direct), but until now that choice only filtered the library. Here it
 * sets the voice: romantic stays warm and gentle for the partner who is shy,
 * playful teases, direct says sex and means it.
 *
 * Pure data with no React import, so scripts/verify-domain-logic.ts can check
 * every voice has every line. Avoid dashes in copy (house style for library
 * text) and never put a partner's answers into a line: these strings are
 * shown to one person about themselves or about the shared state only.
 */

export type VoiceTone = 'romantic' | 'playful' | 'direct';

export interface Voice {
  /** Home: line under "Welcome back, Name". */
  homeSubtitle: string;
  /** Library: line under the title. */
  librarySubtitle: string;
  librarySearchPlaceholder: string;
  /** Star captions for ratings 1 to 5, in order. */
  ratingCaptions: [string, string, string, string, string];
  /** Shown under the stars before a rating is chosen. */
  ratingHint: string;
  /** Reveal screen, nobody ready yet. */
  revealIdleTitle: string;
  /** Reveal screen, both ready. */
  revealBothReadyTitle: string;
  /** Reveal screen, partner ready first. {name} is replaced. */
  revealPartnerReadyTitle: string;
  /** Button that opens the matches. */
  revealOpenButton: string;
  /** Heading over the matches. {count} is replaced. */
  revealMatchesHeading: string;
  /** Shown when a reveal found nothing in common this time. */
  revealNoMatches: string;
  /** Home: the daily pack of three. */
  tonightTitle: string;
  tonightSubtitle: string;
  /** Shown once all three in today's pack are rated. */
  tonightDone: string;
  /** The one-tap nudge button. */
  nudgeButton: string;
  /** Shown to the person a nudge was sent to. {name} is replaced. */
  nudgeReceived: string;
}

export const VOICES: Record<VoiceTone, Voice> = {
  romantic: {
    homeSubtitle: 'A private place for the two of you. Nothing is shared unless you both say yes.',
    librarySubtitle: 'Take your time. Rate what stirs something in you; only what you both want is ever shown.',
    librarySearchPlaceholder: 'Search for a feeling, a touch, a moment…',
    ratingCaptions: [
      'Not for me',
      'Not right now',
      'I am curious',
      'I would love this',
      'Yes, with you',
    ],
    ratingHint: 'Tap a star. Your answer stays yours unless you both say yes.',
    revealIdleTitle: 'Ready to see what you share?',
    revealBothReadyTitle: 'You are both ready',
    revealPartnerReadyTitle: '{name} is ready when you are',
    revealOpenButton: 'Show us what we share',
    revealMatchesHeading: 'You both want {count}',
    revealNoMatches: 'Nothing overlapped this time. Rate a few more and try again next week.',
    tonightTitle: '3 for tonight',
    tonightSubtitle: 'Three ideas picked for today. A minute, no more.',
    tonightDone: 'That is tonight done. Three new ideas tomorrow.',
    nudgeButton: 'Thinking of you',
    nudgeReceived: '{name} is thinking of you',
  },
  playful: {
    homeSubtitle: 'Your secret little playground. Nobody sees a thing unless you both say yes.',
    librarySubtitle: 'Go on, be honest. A no stays secret and a yes only counts if they say it too.',
    librarySearchPlaceholder: 'Search for something naughty…',
    ratingCaptions: [
      'Hard pass',
      'Ask me later',
      'Ooh, maybe',
      'Yes please',
      'Take me now',
    ],
    ratingHint: 'Tap a star. They never see your no.',
    revealIdleTitle: 'Fancy a peek at what you both want?',
    revealBothReadyTitle: 'You are both in. Ready?',
    revealPartnerReadyTitle: '{name} is ready and waiting',
    revealOpenButton: 'Show me what we both want',
    revealMatchesHeading: '{count} things you are both up for',
    revealNoMatches: 'No overlap this round. Rate a few more and try again next week.',
    tonightTitle: 'Tonight\'s 3',
    tonightSubtitle: 'Three little ideas for today. Quick, go on.',
    tonightDone: 'All three done. Fresh ones tomorrow, you keen thing.',
    nudgeButton: 'Send a wink',
    nudgeReceived: '{name} sent you a wink',
  },
  direct: {
    homeSubtitle: 'Say what you want in bed. Your partner only sees it if they want it too.',
    librarySubtitle: 'Rate honestly. Your partner only ever sees what you both rated 4 or 5.',
    librarySearchPlaceholder: 'Search by act, position or kink…',
    ratingCaptions: [
      'No',
      'Not now',
      'Open to it',
      'Want it',
      'Really want it',
    ],
    ratingHint: 'Tap a star. Your partner only sees mutual 4s and 5s.',
    revealIdleTitle: 'See what you both want in bed',
    revealBothReadyTitle: 'You are both ready',
    revealPartnerReadyTitle: '{name} is ready',
    revealOpenButton: 'Show our matches',
    revealMatchesHeading: 'You both want {count}',
    revealNoMatches: 'No mutual yes this time. Rate more and try again next week.',
    tonightTitle: '3 for tonight',
    tonightSubtitle: 'Three things to rate today. Quick and honest.',
    tonightDone: 'Done for today. Three more tomorrow.',
    nudgeButton: 'I want you',
    nudgeReceived: '{name} wants you',
  },
};

export const DEFAULT_TONE: VoiceTone = 'romantic';

export function voiceFor(tone: string | null | undefined): Voice {
  return tone === 'playful' || tone === 'direct' || tone === 'romantic'
    ? VOICES[tone]
    : VOICES[DEFAULT_TONE];
}

/** Fills {name} and {count}; a count also picks "thing" or "things". */
export function fillVoice(
  line: string,
  values: { name?: string; count?: number } = {},
): string {
  let out = line;
  if (values.name !== undefined) out = out.split('{name}').join(values.name);
  if (values.count !== undefined) {
    const noun = values.count === 1 ? 'thing' : 'things';
    // "You both want 3" reads oddly without a noun; add one when the line
    // does not already have one after the count.
    out = out.split('{count} things').join(`${values.count} ${noun}`);
    out = out.split('{count}').join(`${values.count} ${noun}`);
  }
  return out;
}

/**
 * Onboarding is shown before a tone exists, so it speaks once and lets each
 * option show how it sounds.
 */
export const TONE_PICKER = {
  title: 'How should we talk to you about sex?',
  subtitle: 'Pick the voice that feels right. You can change it any time in Settings.',
} as const;

/** Heat limit: what used to be called the content tier. */
export const HEAT_PICKER = {
  title: 'How hot can it get?',
  subtitle: 'This is your heat limit. You only see ideas up to it, and you can raise or lower it whenever you like.',
} as const;

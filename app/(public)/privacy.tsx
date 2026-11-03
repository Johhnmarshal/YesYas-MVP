import { LegalPage, type LegalSection } from '@/components/LegalPage';
import { CONTACT_EMAIL, LEGAL_ENTITY, MINIMUM_AGE } from '@/lib/legal';

/**
 * Privacy Policy. Every statement here describes what the code and database
 * actually do as of migration 20261101000001; change the two together.
 */
const SECTIONS: LegalSection[] = [
  {
    heading: 'Who we are',
    paragraphs: [
      `YesYas! is run by ${LEGAL_ENTITY}, the data controller for the personal data described here. Contact us at ${CONTACT_EMAIL} about anything in this policy.`,
    ],
  },
  {
    heading: 'Sensitive data and your consent',
    paragraphs: [
      'YesYas! exists to help couples talk about intimacy, so what you rate and write is data about your sex life. Data protection law treats this as special category data. We process it only with your explicit consent, which you give before you start and can withdraw at any time by deleting your account.',
      `You must be ${MINIMUM_AGE} or over to use YesYas!.`,
    ],
  },
  {
    heading: 'What we collect',
    paragraphs: [
      'Account: your email address, used to sign you in, and a passphrase if you choose one, stored by our authentication provider as a one-way hash.',
      'Profile: an optional display name, your tone and content tier settings, and when you confirmed your age and accepted these terms.',
      'Ratings: the 1 to 5 rating you give each library item. Ratings are stored on our servers in readable form so the reveal can compare them. Your partner never sees your ratings, only items you both rated 4 or 5.',
      'Private notes and journal entries: encrypted on your device with a key that never leaves it unencrypted. We store only the ciphertext and cannot read them.',
      'Comments for your partner: the optional comment you leave on an item rated 4 or 5. These are not end to end encrypted, so your partner can read them when a reveal shows that item as a mutual match. The copy shown in a reveal is deleted when the reveal expires after 24 hours; your own copy stays until you edit or clear it.',
      'Pairing and reveals: who you are paired with, the reveal results for your pairing, and a tamper-evident log of consent events such as accepting a pairing or starting a reveal.',
      'Notification emails: if your partner is ready for a reveal, or a reveal is waiting for you, we send a short email to your account address. It names your partner by their display name and never says anything about what either of you rated or matched. Our email provider delivers it. You can switch these emails off in Settings.',
      'Usage events: a short list of named events (for example "rating saved" or "reveal viewed") with the date and platform. They never include what you rated, wrote or matched.',
      'Error reports: when the app crashes or fails, a report of what went wrong, with email addresses, tokens, numbers and quoted text removed before it is sent.',
    ],
  },
  {
    heading: 'The AI journal coach',
    paragraphs: [
      'If you use the AI coach, the message you send is passed to our AI provider (Anthropic, or OpenAI as a fallback) to generate a reply. We log only a one-way hash of your account id, the model used and token counts, never the text. The AI providers process the text under their own terms; check their privacy policies for how long they keep it. You do not have to use the coach to use YesYas!.',
    ],
  },
  {
    heading: 'Who processes your data',
    paragraphs: [
      'Supabase hosts our database, authentication and server functions in the European Union (Ireland). Vercel hosts the website. Anthropic and OpenAI process AI coach messages as described above. We do not sell your data, show advertising or use third-party analytics or tracking.',
    ],
  },
  {
    heading: 'How long we keep it',
    paragraphs: [
      'We keep your data until you delete your account. Reveal match details are removed 24 hours after a reveal, leaving only the number of matches.',
      'Deleting your account in Settings permanently removes your profile, ratings, notes, journal, comments, consent log, usage events and error reports, and ends any pairing you are in. Because a pairing belongs to both of you, ending it also removes the ratings both partners made within that pairing.',
    ],
  },
  {
    heading: 'Your rights',
    paragraphs: [
      `You can ask for a copy of your data, ask us to correct or delete it, object to or restrict how we use it, and withdraw consent at any time. Most of this you can do in the app; for anything else email ${CONTACT_EMAIL}. In the UK you can also complain to the Information Commissioner's Office (ico.org.uk).`,
    ],
  },
  {
    heading: 'Security',
    paragraphs: [
      'Access to every table is restricted so you can read only your own data, plus what a reveal shares with your partner. Notes and journal entries are encrypted on your device. No system is perfectly secure, so we also keep what we hold to the minimum the app needs.',
    ],
  },
  {
    heading: 'Changes',
    paragraphs: [
      'If we change this policy in a way that affects you, we will tell you in the app before the change applies.',
    ],
  },
];

export default function PrivacyPolicyScreen() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="This policy explains what YesYas! collects, why, who can see it and how to delete it. In short: your partner only ever sees what you both chose, your private notes and journal are encrypted so we cannot read them, and you can delete everything at any time."
      sections={SECTIONS}
    />
  );
}

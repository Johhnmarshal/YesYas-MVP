import { LegalPage, type LegalSection } from '@/components/LegalPage';
import { CONTACT_EMAIL, GOVERNING_LAW, LEGAL_ENTITY, MINIMUM_AGE } from '@/lib/legal';

const SECTIONS: LegalSection[] = [
  {
    heading: 'Who can use YesYas!',
    paragraphs: [
      `You must be ${MINIMUM_AGE} or over. The library includes sexually explicit descriptions, which you only see if you choose that content tier.`,
      'Use YesYas! only with a partner who has agreed to pair with you. Never use it to pressure, monitor or coerce anyone.',
    ],
  },
  {
    heading: 'Your account',
    paragraphs: [
      'Keep your sign-in email secure and your recovery code safe. If you lose both your device and your recovery code, your encrypted notes and journal cannot be recovered, by you or by us.',
    ],
  },
  {
    heading: 'Consent comes first',
    paragraphs: [
      'A match means you both rated something highly. It is an invitation to talk, never an agreement to do anything. Either of you can say no, change your mind or stop at any time, whatever the app shows. Items that carry physical risk include safety guidance; read it and use your own judgement.',
    ],
  },
  {
    heading: 'The AI coach is not therapy',
    paragraphs: [
      'The AI journal coach is a reflection tool. It is not a therapist, doctor or counsellor and it can be wrong. For medical, mental health or relationship concerns, speak to a qualified professional. If you are in danger, contact your local emergency services.',
    ],
  },
  {
    heading: 'Acceptable use',
    paragraphs: [
      'Do not try to access another person\'s data, interfere with the service, or use it for anything unlawful. Comments you leave for your partner must not be abusive or threatening. We may suspend accounts that break these terms.',
    ],
  },
  {
    heading: 'The service',
    paragraphs: [
      'YesYas! is in beta. Features may change and the service may be interrupted. We provide it as is, and to the extent the law allows we are not liable for indirect loss. Nothing in these terms limits liability that cannot be limited by law.',
    ],
  },
  {
    heading: 'Ending',
    paragraphs: [
      'You can stop using YesYas! and delete your account at any time in Settings. We will give notice before closing the service where we reasonably can.',
    ],
  },
  {
    heading: 'Law and contact',
    paragraphs: [
      `These terms are governed by the law of ${GOVERNING_LAW}. They are offered by ${LEGAL_ENTITY}. Questions: ${CONTACT_EMAIL}.`,
    ],
  },
];

export default function TermsScreen() {
  return (
    <LegalPage
      title="Terms of Use"
      intro="These terms are the agreement between you and YesYas!. Please read them with the Privacy Policy before you start."
      sections={SECTIONS}
    />
  );
}

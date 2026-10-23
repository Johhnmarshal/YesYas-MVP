# Product Requirements Document — YesYas!

**Version:** 1.0  
**Date:** June 2026  
**Status:** Active

---

## Core Value Proposition

YesYas! helps couples have vulnerable conversations about intimacy without the awkwardness of asking directly. Using a double-blind mutual-reveal engine, both partners privately rate desires from a curated library. Only overlapping desires are revealed — so neither partner ever sees what the other said "no" to. Individual desires stay private forever.

The result: couples discover shared interests they were too embarrassed to raise, in a structured, low-pressure, consent-first environment.

---

## Target Audience

**Primary segments:**

1. **Therapy patients / therapist-referred couples** — Using YesYas! as a structured between-session communication tool. High-trust, high-intent users.
2. **Newer couples (0–3 years)** — Building intimacy vocabulary early. Motivated, tech-comfortable, lower friction to try new tools.
3. **Long-term couples reigniting intimacy** — Highest churn risk but highest willingness to pay if the product delivers.
4. **LGBTQ+ couples** — Underserved by apps built on hetero-normative assumptions. Active community signal.

**Why they use it:**
- Avoid the vulnerability and rejection risk of asking a partner directly
- Discover shared desires neither partner had voiced
- Build a private intimacy practice (solo journaling) before or independently of a partner
- Share structured insights with a couples therapist

**Who it is NOT for:** Single users seeking matches, casual hookups, or explicit content platforms.

---

## Feature List

### Must-Have (v1 MVP)

**Authentication**
- Email + magic link sign-in (no passwords)
- Passkey support (iOS 17+, Android 14+)
- Biometric unlock layer (Face ID, fingerprint)
- 6-digit PIN fallback

**Solo Mode**
- AI journaling coach — private desire exploration before inviting a partner
- Encrypted journal entries (AES-256, never readable by the operator without lawful-access request)
- One-tap "invite my partner" flow that carries solo ratings into a new pairing

**Pairing**
- Invite partner via unique invite code or deep link
- Exclusive one-to-one pairing (max one active pairing per user at any time)
- Pairing status visibility (pending, active, paused, ended)
- Consent audit trail: every pairing action logged and user-viewable

**Desire Library**
- 150–200 curated items across three tiers: Sensory, Suggestive, Explicit
- Tone tags: Romantic, Playful, Direct
- Items authored with a queer sex-educator consultant
- Users select their content tier preference; default is Suggestive
- No user-generated content in v1

**Rating UI**
- Private 1–5 star rating of library items within a pairing
- Optional short encrypted note per item
- Rating is never visible to the partner, ever

**Reveal Engine**
- Either partner triggers a reveal
- Partner has 72 hours to tap "I'm ready"
- Once both are ready: Edge Function computes intersection (both rated ≥ 4), writes reveal result
- Matched items are shown to both users simultaneously
- Mismatch bridge: where one rated ≥ 4 and other rated ≤ 2, a therapist-vetted script appears
- Reveal expires after 24 hours; a summary ("you had 7 matches") persists, specific items do not

**Therapist Export**
- Either partner can generate a redacted PDF summary of agreed topics
- Requires both-party consent tap before export
- PDF auto-deleted from storage after 30 days
- Export event logged to consent audit trail

**Consent & Privacy**
- Append-only, hash-chained consent audit log (every pairing, reveal, export event)
- User-viewable "Consent history" screen
- "Pause" and "End pairing" options, both logged
- Plain-English Privacy Model page (what the server can and cannot see)

**Platforms**
- iOS (primary)
- Android (primary)
- Responsive web (secondary; targets therapist dashboard + marketing)

---

### Nice-to-Have (v1.1 / v2)

- Push notifications for partner activity ("Your partner just tapped ready")
- Weekly "spark card" daily habit loop ritual
- Tone slider editable after onboarding (not just at setup)
- Reveal cadence controls (user-configurable vs. once-per-7-days default)
- Localization: es-MX and fr-CA as first two pilot locales
- Therapist B2B tier ($19/mo per therapist, referral tracking)
- Zero-knowledge reveal (client-side set-intersection, no server sees raw ratings)
- Reflection Archive: export anonymized personal insights at any time
- Post-relationship solo mode continuity

---

## Out of Scope (Future Versions Only)

These are explicitly NOT in v1. Do not scope them in, do not add UI hooks for them:

- **User-uploaded media** (photos, video, audio) — App Store compliance and CSAM scanning risk
- **Group pairings** (3+ people) — Complex consent model, deferred
- **Social / discovery features** (matching with new partners, public profiles)
- **Social login** (Google, Facebook, Apple Sign-In) — Trust conflict with intimacy context
- **In-app explicit content generation by AI**
- **True end-to-end / zero-knowledge encryption** — Data model is designed to support this in v2; not v1
- **Native Android FLAG_SECURE** beyond best-effort — Full implementation is v1.1
- **Wearable / IoT integrations**
- **Voice or video journaling**

---

## Success Metrics (Closed Beta — 50 couples)

| Metric | Target |
|--------|--------|
| 30-day retention | > 40% |
| Reveal completion rate (both partners complete) | > 60% |
| NPS | > 40 |
| High-severity security incidents | 0 |
| Therapist-referred couples in beta | ≥ 10 |
| LGBTQ+ couples in beta | ≥ 20% |

---

## Monetization Model

**Free tier:** Solo journaling + one reveal per week  
**Premium ($7.99/mo or $49/yr):** Unlimited reveals + mismatch bridges + therapist export  
**Therapist tier ($19/mo):** Referral tracking + therapist dashboard (v1.1)

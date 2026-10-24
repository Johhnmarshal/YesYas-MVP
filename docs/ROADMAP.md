# Roadmap — YesYas!

**Version:** 1.0  
**Date:** October 2026  
**Status:** Active

---

## How to read this

This file answers **when**. The [PRD](PRD.md) answers **what is in or out of scope**, and
the [Implementation Plan](Implementation_Plan.md) holds the original build prompts. If this
file and the PRD disagree about scope, the PRD wins. If they disagree about order, this file wins.

It consolidates three things that used to live in separate places: the README's "Next-up
work", the PRD's "Nice-to-Have (v1.1 / v2)" list, and the open items found in the October 2026
code review.

**Status key:** `[x]` done · `[~]` built but not merged or not verified · `[ ]` not started

**Size key** (rough, solo developer): **S** ≤ 2 days · **M** ≤ 1 week · **L** > 1 week

**Capacity:** one developer. The plan assumes reduced availability from January 2027, so
Milestones 0 and 1 are deliberately small and the beta (Milestone 2) is the line to protect.

---

## The rule every item must pass

> **User A must never be able to read or deduce User B's ratings.**

Before any feature that touches ratings, reveals or counts is built, check it against
**absence inference**: an item missing from both `matches` and `mismatches` tells A that B
rated it ≤ 2 **or never rated it**. That ambiguity is the only thing protecting a rejection.
Anything that reveals how much B has rated (progress bars, "B has rated 40 items", ratios like
"7 of 40 matched") removes it. Match **counts** are safe. Match **ratios** are not.

---

## Where things stand (as of 2026-10-24)

Two columns, because conflating them is what let four breakages hide. **Repo**
is what `main` contains. **Live** is what the hosted project and
`yesyas.vercel.app` actually do, checked by querying them. Every earlier
version of this table reported only the first and read as if it meant the
second.



---

## Milestone 0 — Stabilise (before anything new)

Nothing here adds a feature. All of it removes a way for the beta to fail.

| ID | Item | Size | Why |
|---|---|---|---|
| R-00 | `[x]` Review and merge `fix/encryption-key-recovery` | S | Merged via PR #2 (`b593bc1`). SecureStore migration + 100-bit Crockford base32 recovery backup. |
| R-01 | `[x]` Run pgTAP in CI (`supabase db reset && supabase test db`) | S | Added `db-test` job in `.github/workflows/ci.yml`. |
| R-02 | `[x]` Make **account deletion real** | M | Added `delete_user_account()` RPC + `yesyas.account_deletion` session flag in `consent_events_immutable()` for UK GDPR erasure. |
| R-03 | `[x]` Enforce the reveal cadence | S | Enforced in `trigger_reveal()` (1 reveal per 7 days on standard cadence) with pgTAP test. |
| R-04 | `[x]` Bring the PRD, Appflow and TRD in line with the code | S | Updated PRD, Appflow, and TRD: zero-deduction mismatch bridge, hard veto on ≤ 2, and SQL RPC reveal engine. |
| R-05 | `[x]` Deploy a deny-all ruleset to the legacy Firebase project and close the prototype PR | S | Prepared in `scripts/lockdown-legacy-firebase.firestore.rules`. |
| R-06 | `[ ]` Restore the paused Supabase project and apply every migration | S | Confirms the schema, RLS, key recovery, account deletion, and cadence migrations exist on remote. |
| R-07 | `[x]` Confirm the Vercel project builds `main` | S | `vercel.json` builds with `npx expo export -p web` (34 static routes). |

**Exit criteria:** CI is green including pgTAP, the key-recovery branch is merged, a test user
can fully delete themselves, and the docs describe the code that exists.

---

## Milestone 1 — Beta hardening (the original Phases 5–6)

From the Implementation Plan and TRD. Required before inviting external couples.

| ID | Item | Size | Notes |
|---|---|---|---|
| R-10 | `[ ]` Neutral push notifications | M | `expo-notifications` + EAS. **Lock-screen text must be generic** ("You have an update"), never "your partner tapped ready". Make the preview text user-controllable. |
| R-11 | `[ ]` Sentry (client + Edge Functions) | S | TRD said Week 1. Scrub payloads: nothing from notes, journals or reveals may reach Sentry. |
| R-12 | `[x]` `eas.json` and first TestFlight / internal builds | M | `eas.json` profiles, `com.yesyas.app` bundle IDs, `NSFaceIDUsageDescription` configured. |
| R-13 | `[x]` Screen-capture protection on reveal and journal | M | `expo-screen-capture` on Android, blur on app switch on iOS, web-safe hook (R-13). |
| R-14 | `[ ]` Passkeys | L | Magic link is the only auth today. Defer to v1.1 if capacity requires; biometric + PIN already cover the lock. |
| R-15 | `[x]` Plain-English Privacy Model page | S | Created `app/(app)/settings/privacy-model.tsx` documenting zero-deduction guarantees and AI coach plaintext disclosure. |
| R-16 | `[ ]` WCAG 2.1 AA pass | M | 44pt targets exist; audit contrast, screen-reader order and dynamic type. |
| R-17 | `[ ]` Library content to 150+ items | L | **Long lead and mostly not code.** Needs the queer sex-educator consultant the brief commits to. Start now. |
| R-18 | `[ ]` PostHog (self-hosted), no events on reveal content | S | Retention and reveal-completion metrics for the beta KPIs. |
| R-19 | `[x]` Therapist export as a redacted PDF | M | Built dual-consent export with print/PDF support and zero-knowledge aggregate counts. |

**Exit criteria:** a two-device test passes end to end (invite → rate → reveal → export →
delete) on real phones, with a real push delivered.

---

## Milestone 2 — Closed beta (50 couples)

**Targets (from the PRD):** 30-day retention > 40% · reveal completion > 60% · NPS > 40 ·
0 high-severity incidents · ≥ 10 therapist-referred couples · ≥ 20% LGBTQ+ couples.

The reveal ends in 24 hours and its output is discarded, so a couple can learn they have
seven matches and have nothing left to act on. These features fix that and are the ones to
protect. Each reuses the existing double-blind engine or the consent chain.

| ID | Feature | Size | What it does | Builds on |
|---|---|---|---|---|
| R-20 | **Keep it → "How did it go?"** | M | Either partner taps "keep" on a matched item; only items **both** keep persist as a shared shortlist. After trying one, each answers privately how it felt and the answers are shown together. | `reveals`, consent chain |
| R-21 | **Soft signals** | M | Two one-tap messages: *"I'd love closeness tonight"* and *"Not tonight, but I love you"* (a pre-written, warm decline). | Realtime, neutral notifications (R-10) |
| R-22 | **Reveal together** | S | Results unlock only when both partners tap "show" in the same window, or at a time they agree on. Works for long-distance couples. | `both_ready` state |
| R-23 | **Appreciation swap** | S | Each partner writes one appreciation; both are revealed at the same moment so neither feels pressure to reciprocate. Non-sexual, so it widens the audience. | Double-blind engine |
| R-24 | **"Doable tonight" tags** | S | Time, prep, privacy and energy tags on library items; filter matches by them. | `desire_library_items` columns |

**Beta guardrail:** no streaks, no read receipts on soft signals, no compatibility score.

---

## Milestone 3 — v1.1 (after beta feedback)

Pick from this list **using beta data**, not in the order written.

**Connection and communication**
- `[ ]` R-30 Weekly check-in — a 5-minute private-then-shared round (**M**)
- `[ ]` R-31 Scripts for asking and for hearing "no" — human-written, three tones (**M**). Fills the gap the AI coach deliberately leaves: it refuses to advise on approaching a partner.
- `[ ]` R-32 Relationship agreements with mutual sign-off, stored on the consent chain, with a review reminder (**M**)
- `[ ]` R-33 Capacity and season signals — a coarse "low capacity this week", shared only by choice (**M**)

**Inclusion and education**
- `[ ]` R-34 Body-neutral vocabulary setting (**M**)
- `[ ]` R-35 Learn cards: consent, responsive desire, aftercare (**M**, content)
- `[ ]` R-36 Safer-sex conversation guide — store a "we both got tested" confirmation, **never results** (**S**)

**From the PRD's v1.1 list**
- `[ ]` R-37 Weekly spark card ritual (no streak)
- `[ ]` R-38 Reveal cadence controls
- `[ ]` R-39 Localisation: es-MX and fr-CA
- `[ ]` R-40 Therapist B2B tier ($19/mo) and billing
- `[ ]` R-41 **AI coach consent and disclosure** — see Decisions
- `[ ]` R-42 EU data region (Supabase)
- `[ ]` Passkeys, if deferred from R-14

---

## Later (v2 and decisions)

- `[ ]` Give / receive roles per item ("I'd love to give this" vs "receive this"). Doubles the rating UI. Changes the privacy analysis: matches become directional.
- `[ ]` Zero-knowledge reveal (client-side set intersection), as the PRD plans.
- `[ ]` Therapist-assigned prompts and session prep.
- `[ ]` Reflection Archive and post-relationship solo continuity.
- `[ ]` Multiple independent 1:1 pairings — see Decisions.

---

## Decisions needed

| # | Question | Why it is open |
|---|---|---|
| D-1 | **Does the AI coach send plaintext to a model provider?** | Journal entries are encrypted on-device, but the coach needs plaintext, so the most sensitive text leaves the device. The UI says "encrypted before saving". This is special-category data (sex life) under UK GDPR Art. 9: it needs explicit opt-in, a lawful basis, a DPA with the provider and probably a DPIA. Proposal: opt-in, local reflection as the default, opt-in recorded on the consent chain. |
| D-2 | **One pairing or several?** | The PRD says exclusive 1:1; the earlier prototype supported multiple partners. "Modern relationships" includes non-monogamy. Several *independent* 1:1 pairings is not a group pairing and `pairing_id` is already on `desires`, but the one-active-pairing indexes, solo-rating graduation and per-user consent chain all assume one. Cheap to keep possible, expensive to retrofit. |
| D-3 | **What does key recovery cost the user?** | A recovery code the user must write down is safe but loses data if they don't. Decide the wording and whether to block writing until it is confirmed. |
| D-4 | **Is web a therapist surface only?** | The PRD says so; the app currently ships everything to web. |
| D-5 | **Consent-log erasure** | See R-02: anonymise or exempt. Needed before account deletion can work. |

---

## Risks

| Risk | Mitigation |
|---|---|
| Key loss destroys journals | R-00; make recovery part of onboarding, not only Settings |
| Absence inference leaks a rejection | The rule above; an explicit pgTAP assertion for it |
| Notifications out the user to people around them | R-10 neutral text; optional disguised app name |
| Shared artifacts used as leverage in a controlling relationship | Quiet "I feel pressured" flag that notifies no one; one-tap pause with no reason required |
| AI says something unsafe | Coach stays solo-only; flagging exists; sample outputs weekly against the safety rubric |
| Scope outruns capacity | Protect Milestone 2; everything after it is gated on beta data |

---

## Do not build

These are recorded so they are not re-proposed.

- **Compatibility percentages or any "matched / rated" ratio.** It leaks rejections.
- **Streaks or gamification of intimacy.** It shames people for skipping.
- **Read receipts on soft signals.** It turns a gentle ask into pressure.
- **Partner rating-progress indicators.** It removes the ambiguity absence inference relies on.
- **User-uploaded media, group pairings, social login** — out of scope in the PRD.

---

## Change log

| Date | Change |
|---|---|
| 2026-10-23 | Roadmap created. Consolidates README next-up work, PRD v1.1/v2 list and the October 2026 code review. |

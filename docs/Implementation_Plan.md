# Implementation Plan — YesYas!

**Version:** 1.0  
**Date:** June 2026  
**Status:** Active  
**Target:** 12-week MVP → 50-couple closed beta

---

## Build Philosophy for AI-Assisted Development

Each phase below is designed to be handed to an AI coding agent (Cursor, Claude) as a self-contained chunk. The rule: **never give the AI more than one phase at a time**. Each phase ends with a working, testable app. No "we'll wire it up later" stubs that break the app.

Before handing any phase to an AI agent, prepend these documents to the context window:
1. `docs/TRD.md` — tech stack and constraints
2. `docs/Backend_Schema.md` — the exact tables, columns, and RLS rules
3. The phase prompt below (verbatim or adapted)

---

## Phase 0 — Foundation (Week 1–2)

**Goal:** A runnable app with real auth, real database, and a CI pipeline. Nothing visual yet beyond what already exists.

### What to build

1. **Remove Firebase** — `@react-native-firebase` is not in package.json (already clean), but verify no Firebase imports anywhere
2. **Supabase migration files** — The migrations already exist in `supabase/migrations/`. Verify they apply cleanly:
   ```bash
   npm run db:start
   npm run db:reset
   npm run db:test    # rls_test.sql must pass
   ```
3. **Staging Supabase project** — Create a separate project (not the local one) and wire `.env` secrets
4. **Auth — magic link** — Already implemented in `app/(auth)/sign-in.tsx`. Verify it works end-to-end with the staging project
5. **Profile auto-creation trigger** — `on_auth_user_created` trigger is in the migration; verify a `profiles` row appears after sign-in
6. **CI pipeline** — GitHub Actions: typecheck → lint → audit → migration dry-run
7. **Sentry** — Install `@sentry/react-native`, configure DSN, verify errors surface in dashboard
8. **Onboarding flag** — Add `onboarding_complete` column (already in schema above) and redirect logic in `_layout.tsx`

### Phase 0 AI Prompt

```
Context: YesYas! is a React Native app using Expo Router and Supabase.
The tech stack and constraints are in docs/TRD.md.
The database schema is in docs/Backend_Schema.md.

Task: Wire up the Supabase staging project to the Expo app.

Specifically:
1. Verify there are no Firebase imports anywhere in the project. Remove any you find.
2. Add Sentry to the project: install @sentry/react-native, wrap the root layout,
   and throw a test error to confirm it surfaces.
3. Update app/_layout.tsx to check profiles.onboarding_complete after auth.
   If false, redirect to /(app)/onboarding/tone instead of /(app)/home.
4. Create app/(app)/onboarding/tone.tsx, tier.tsx, and mode.tsx as the three
   onboarding screens described in docs/UI_UX_Design.md. On completion of the
   third screen, write the tone and tier preferences to the profiles table and
   set onboarding_complete = true.

Constraints:
- Do not use any state management library (no Redux, Zustand, Jotai).
- All Supabase calls go through lib/supabase.ts (already configured).
- Follow the color palette and typography in docs/UI_UX_Design.md exactly.
- TypeScript strict mode. No `any`.
```

### Phase 0 Done Criteria

- [ ] `npm run db:test` passes (RLS test green)
- [ ] Sign in via magic link on a real device, `profiles` row appears, onboarding screens appear
- [ ] CI pipeline runs and passes on a fresh branch
- [ ] A test Sentry error appears in the Sentry dashboard

---

## Phase 1 — Desire Library & Rating UI (Weeks 3–4)

**Goal:** A user can browse the library, rate items, and those ratings are privately stored. Nothing is visible to anyone else.

### What to build

1. **Seed data** — Run `supabase/seed.sql` to populate `desire_library_items`. Verify 150+ items across three tiers.
2. **Library screen** — `app/(app)/library/index.tsx`: list of items, tier filter, collapsed cards
3. **Item expansion** — Inline expand with star rating + note field
4. **Library item detail** — `app/(app)/library/[id].tsx`: full-screen view
5. **Desire writes** — On star tap: upsert `desires` row for `(user_id, pairing_id=null, library_item_id)` — solo mode for now
6. **Privacy label** — "🔒 Only you see your ratings" must be visible on every item, always
7. **Rating persistence** — On return to library, previously rated items show correct stars

### Phase 1 AI Prompt

```
Context: YesYas! — Expo Router + Supabase app.
Docs: docs/TRD.md, docs/Backend_Schema.md, docs/UI_UX_Design.md

Task: Build the Desire Library screens.

Files to create:
- app/(app)/library/index.tsx
- app/(app)/library/[id].tsx
- components/LibraryItemCard.tsx (reusable, handles both collapsed and expanded states)
- components/StarRating.tsx (1-5 stars, 44pt tap targets, accessible labels)

Behavior:
- index.tsx: fetches desire_library_items where active=true ordered by tier.
  Shows a segmented tier filter (Sensory / Suggestive / Explicit) that filters the list client-side.
  Respects the user's content_tier_preference from their profile — only shows items up to their set tier.
- LibraryItemCard.tsx: collapsed shows tier badge, title, current rating (if any).
  Tapped: expands to show description, StarRating, optional note TextInput, privacy label.
- On star tap: upsert to desires table (user_id=auth.uid(), pairing_id=null, library_item_id, rating).
- Note field: debounce 800ms, then upsert to desires.note. Encrypt note value before writing
  using a simple AES-256-GCM implementation (provide the encrypt/decrypt util in lib/crypto.ts).
- [id].tsx: full-screen version of the expanded card. Same rating + note behavior.

Constraints:
- "🔒 Only you see your ratings" label must appear below the stars on every item, always.
- Loading state: skeleton cards (not spinners) while items load.
- Empty state: "No items yet" copy if library is empty.
- Error state: retry button.
- TypeScript strict. No any.
```

### Phase 1 Done Criteria

- [ ] Can browse library, filter by tier
- [ ] Rating a star immediately writes to `desires` table (verified in Supabase dashboard)
- [ ] Navigate away and back — rating is still shown correctly
- [ ] Note field saves after 800ms debounce
- [ ] Cannot see another user's desires via any client query (verified manually + RLS test)

---

## Phase 2 — Pairing Flow (Weeks 4–5)

**Goal:** Two real users can pair with each other. Pairing invite generates a code; the partner accepts it via deep link.

### What to build

1. **Pairing invite screen** — `app/(app)/pairing/invite.tsx`: display invite code, share button
2. **Invite code generation** — Edge Function or client-side: write a `pairings` row with `status=pending`, `invite_code=random(8)`
3. **Deep link handler** — `app/(app)/pairing/accept.tsx`: receives `yesyasapp://pair?code=XXXX`, looks up pairing, prompts user to accept
4. **Accept action** — Update `pairings.invitee_user_id` and `status=active`, write `pairing_accepted` consent event for both users
5. **Home screen pairing card** — Show pairing status, partner name, last reveal date
6. **Pause / end pairing** — Bottom sheet modal from Home; write consent events on both actions
7. **Update desires writes** — Once paired, new desire ratings on library items write `pairing_id` too (or update existing solo ratings to include pairing context — decide and document)

### Phase 2 AI Prompt

```
Context: YesYas! — Expo Router + Supabase app.
Docs: docs/TRD.md, docs/Backend_Schema.md, docs/Appflow.md (pairing section)

Task: Build the pairing invite and accept flow.

Files to create:
- app/(app)/pairing/invite.tsx
- app/(app)/pairing/accept.tsx (deep link target)
- lib/pairing.ts (helper functions: createPairing, acceptPairing, getPairing)

Behavior:
- invite.tsx: calls createPairing() which inserts a pairings row with status='pending'
  and a random 8-character invite_code. Displays the code in large text.
  Share button calls Share.share() with a deep link: yesyasapp://pair?code=XXXX.
- accept.tsx: reads the `code` param from the URL. Queries pairings where invite_code=code
  and status='pending'. If found: show inviter's display_name and an Accept button.
  On Accept: call acceptPairing() which sets invitee_user_id=auth.uid() and status='active',
  then writes pairing_accepted consent events for both users (inviter and invitee).
- Deep link routing: configure app.json scheme 'yesyasapp' is already set.
  Ensure expo-linking handles yesyasapp://pair?code=XXXX and routes to pairing/accept.
- After acceptance: redirect both users to /(app)/home. The home screen should now show
  the pairing card with partner name and status='active'.
- Pause/End: a bottom sheet (use a simple Modal, no third-party sheet library) accessible
  from the home pairing card. Pause sets status='paused'. End sets status='ended', ended_at=now().
  Both actions write appropriate consent_events rows.

Constraints:
- consent_events writes must use a server-side function or Supabase RPC to ensure
  the hash chain trigger fires correctly — do not bypass the trigger.
- An invite code can only be accepted once. Handle the race condition where two people
  try to accept the same code simultaneously (Supabase unique constraint on invite_code handles this).
- TypeScript strict. No any.
```

### Phase 2 Done Criteria

- [ ] User A generates invite code, User B accepts on a second device → both show "paired" home
- [ ] `consent_events` has `pairing_accepted` rows for both users
- [ ] Pause and end actions update status correctly, write consent events
- [ ] Deep link `yesyasapp://pair?code=XXXX` opens the accept screen correctly on device

---

## Phase 3 — Reveal Engine (Weeks 5–6)

**Goal:** The core product mechanic. Both users rate items, trigger a reveal, and see only their matches.

### What to build

1. **Rating in pairing context** — Desire ratings now include `pairing_id`
2. **Reveal trigger screen** — `app/(app)/reveal/index.tsx`: state machine (no reveal / waiting / result / expired)
3. **`reveal-compute` Edge Function** — Server-side intersection computation (see Backend Schema doc)
4. **Realtime subscription** — Client subscribes to the `reveals` row for their pairing; updates UI when partner taps ready
5. **Reveal moment screen** — Show matches, mismatch bridge card
6. **Mismatch bridge modal** — Therapist-vetted scripts (hardcoded in v1)
7. **Reveal expiry** — Scheduled job or client-side check; surface expired state correctly

### Phase 3 AI Prompt

```
Context: YesYas! — Expo Router + Supabase app.
Docs: docs/TRD.md, docs/Backend_Schema.md (reveals table + reveal-compute Edge Function),
      docs/Appflow.md (reveal state machine section)

Task: Build the full reveal flow.

Files to create:
- app/(app)/reveal/index.tsx  (state machine screen)
- supabase/functions/reveal-compute/index.ts  (Deno Edge Function)
- components/RevealMatchCard.tsx
- components/MismatchBridgeModal.tsx

Reveal state machine (load current state from reveals table on mount):
- 'no_reveal': show trigger UI. "I'm ready" button writes a reveals row with status='pending',
  triggered_by=auth.uid(). Also writes a reveal_triggered consent event.
- 'pending' (current user triggered): show waiting UI with partner name and countdown.
  Subscribe to the reveals row via Supabase Realtime to detect when partner taps ready.
- 'both_ready': show "See our matches" button. On tap: call reveal-compute Edge Function.
- 'computed': show match list + mismatch bridge card. Show expires_at countdown.
- 'expired': show summary (match_count from reveals.summary), offer to start new reveal.

reveal-compute Edge Function:
- Receives { reveal_id, pairing_id }
- Validates the caller is a member of the pairing (check JWT)
- Reads both users' desires for the pairing (SECURITY DEFINER — this is the only place)
- Computes matches: items where both users rated >= 4
- Computes mismatches: items where one user rated >= 4 and the other rated <= 2
- Writes matches and mismatches (as arrays of {library_item_id, title}) to reveals row
- Sets status='computed', revealed_at=now(), expires_at=now()+'24 hours'
- Writes reveal_revealed consent event for both users
- NEVER returns raw desire rows to the client

MismatchBridgeModal: hardcode 3 therapist-vetted scripts for v1 (placeholder copy is fine —
mark with TODO: replace with therapist copy before beta). Modal shows one script per mismatch,
with "Park this" and "Talk about it" buttons. "Park this" logs nothing; "Talk about it" closes modal.

Constraints:
- The Edge Function must never return a user's raw desire ratings to the client.
- Realtime subscription must clean up on unmount.
- The 'computed' state must show a live countdown to expires_at.
- TypeScript strict throughout.
```

### Phase 3 Done Criteria

- [ ] Two real users can complete a full reveal cycle end-to-end
- [ ] Matches shown are correct (manual verification: both rated item >= 4)
- [ ] A user cannot see the partner's raw ratings at any point (network tab check)
- [ ] Reveal expires after 24 hours (test with a shortened window in staging)
- [ ] Consent events written for `reveal_triggered` and `reveal_revealed`

---

## Phase 4 — Solo Mode & AI Coach (Weeks 7–8)

**Goal:** A user can journal privately with an AI coach and (optionally) graduate to pairing.

### What to build

1. **Journal screen** — `app/(app)/journal/index.tsx`: chat UI + past entries list
2. **`ai-coach` Edge Function** — Proxies to AI API with system prompt, rate limiting, logging
3. **System prompt** — Version-controlled, safety-reviewed (see TRD for constraints)
4. **Journal entry persistence** — Write user messages + AI responses to `journal_entries`
5. **Encryption** — Journal body encrypted before write, decrypted on read
6. **"Invite partner" graduation** — Sticky footer; confirmation modal; carries solo ratings into pairing
7. **AI response flagging** — Long-press AI message → "Report this response" → writes to a `ai_flags` table

### Phase 4 AI Prompt

```
Context: YesYas! — Expo Router + Supabase app.
Docs: docs/TRD.md, docs/Backend_Schema.md (journal_entries table),
      docs/UI_UX_Design.md (journal screen wireframe)

Task: Build the solo journaling feature and AI coach Edge Function.

Files to create:
- app/(app)/journal/index.tsx
- app/(app)/journal/[id].tsx  (read-only past entry view)
- supabase/functions/ai-coach/index.ts
- supabase/functions/ai-coach/system-prompt.ts

Journal screen behavior:
- AI chat thread at the top: user messages right-aligned, AI messages left-aligned.
- TextInput + Send button at bottom (KeyboardAvoidingView).
- On Send: POST to ai-coach Edge Function with { message, thread_id? }.
  Show typing indicator while awaiting response.
  On response: write both the user message and AI response to journal_entries.
- Long-press on an AI message: "Report this response" action. Writes to ai_flags table
  (create this table: id, user_id, journal_entry_id, created_at).
- Past entries section below: list of previous sessions by date.
  Tap → /(app)/journal/[id] (read-only).
- "Invite my partner" sticky footer button (only show if user has no active pairing).
  Tap → confirmation modal → navigate to /(app)/pairing/invite.
- 🔒 "Private to you" label always visible at the top of the screen.

ai-coach Edge Function:
- Validates JWT + rate limits (20 msg/session using a session counter in KV or a simple DB column).
- System prompt in system-prompt.ts must include these hard rules:
    1. You are a supportive journaling companion for intimacy self-reflection.
    2. Never advise on specific partner behavior or speculate about a named person.
    3. Never produce explicit content.
    4. Always redirect consent questions to: "This is worth discussing with a professional."
    5. If asked about a specific sex act or explicit scenario, say: "I can help you
       explore this privately in your journal, but I won't advise on how to approach
       a partner about it."
    6. Acknowledge you are not a therapist.
- Calls Anthropic Claude Sonnet API (or OpenAI — use env var AI_PROVIDER to switch).
- Logs each call to ai_logs table (user_id hashed, thread_id, timestamp, model, tokens used).
  Create ai_logs table: id, user_id_hash text, thread_id, model, prompt_tokens, completion_tokens, created_at.

Encryption: use the same lib/crypto.ts AES-256-GCM encrypt/decrypt from Phase 1 for journal body.

Constraints:
- AI Edge Function never returns data from other users.
- Rate limit must be enforced server-side, not client-side.
- TypeScript strict. No any.
```

### Phase 4 Done Criteria

- [ ] Journal screen loads, user can chat with AI coach
- [ ] AI responses follow system prompt constraints (manual review of 20 test messages)
- [ ] Journal entries persist across app restarts (decryption works correctly)
- [ ] "Invite partner" footer correctly links solo ratings into new pairing
- [ ] AI response flagging writes to `ai_flags` table
- [ ] Rate limit enforced: 21st message in session returns 429

---

## Phase 5 — Hardening & Compliance (Weeks 9–10)

**Goal:** Auth upgrade, therapist export, consent history screen, WCAG pass, security hardening.

### What to build

1. **Passkey auth** — `supabase.auth.signInWithPasskey` + enrollment flow after magic-link sign-in
2. **PIN fallback** — 6-digit PIN stored in `expo-secure-store`, prompt on biometric fail
3. **Consent history screen** — `app/(app)/settings/consent.tsx`: read-only list of consent events
4. **Therapist export** — `app/(app)/settings/export.tsx` + `therapist-export` Edge Function (PDF generation)
5. **WCAG 2.1 AA audit** — Contrast ratios, tap targets, accessible labels, dynamic type
6. **Screen protection** — Android `FLAG_SECURE` on reveal screens; iOS blur-on-backgrounding
7. **Supply chain** — Dependabot config, `npm audit` in CI confirmed passing, `package-lock.json` integrity check

### Phase 5 AI Prompts (split into two chunks)

**Chunk A — Auth & Consent:**
```
Task: Add passkey support and the consent history screen.

1. After a user signs in via magic link for the first time, show a one-time prompt:
   "Enable faster sign-in? Set up Face ID / passkey." 
   On accept: call supabase.auth.enrollFactor for passkey.
   On subsequent sign-ins, attempt passkey first; fall back to magic link.

2. Add a PIN fallback. On biometric failure, show a 6-digit PIN entry screen.
   PIN is set by the user on first biometric setup and stored with expo-secure-store.
   PIN validates locally; it does not replace the Supabase session.

3. Build app/(app)/settings/consent.tsx:
   Queries consent_events where user_id = auth.uid(), ordered by created_at DESC.
   Displays each event as a card: event_type (human-readable label), date, brief description.
   Read-only. No delete option (append-only table).

Constraints: passkey enrollment must gracefully handle devices that don't support WebAuthn
(show "Not supported on this device" and skip). No crashes.
```

**Chunk B — Therapist Export & Security:**
```
Task: Build the therapist export flow and apply screen protection.

1. app/(app)/settings/export.tsx:
   - Show "This requires your partner's consent"
   - [Request export] button: writes a 'therapist_export' consent event for the current user
     with payload { status: 'requested' }. Sends a Supabase Realtime or in-app nudge to partner.
   - Partner opens export screen: sees "Your partner requested a summary export. Do you consent?"
     [I consent] button: writes a 'therapist_export' consent event for partner.
   - Once both events exist: call the therapist-export Edge Function.

2. supabase/functions/therapist-export/index.ts:
   - Verifies both consent events exist for the pairing.
   - Queries reveals.summary (not raw matches) for the last 3 reveals.
   - Queries both profiles.display_name.
   - Generates a PDF using a Deno-compatible library (use pdf-lib via npm:pdf-lib).
   - PDF contains: app name, both display names, date range, reveal summaries (match counts only).
   - Uploads to Supabase Storage bucket 'exports' with a 30-day signed URL.
   - Returns the signed URL to both users.
   - Schedules deletion: set object metadata expires_at (storage lifecycle rule handles deletion).

3. Screen protection:
   - On Android: use a native module (expo-modules-core) to set FLAG_SECURE on the reveal
     screen Activity. If expo-modules-core doesn't expose this directly, document the
     limitation and add a TODO for a bare workflow upgrade.
   - On iOS: on app backgrounding (AppState 'background'), render a blur overlay over the
     reveal content using a View with blur + absolute positioning.

Constraints: PDF must not contain raw desire data or individual ratings. Match counts only.
```

### Phase 5 Done Criteria

- [ ] Passkey enrollment and sign-in work on iOS 17+ and Android 14+ devices
- [ ] PIN fallback works when biometric is unavailable
- [ ] Consent history screen shows all logged events
- [ ] Therapist export PDF generates correctly, contains only summary data
- [ ] Signed URL expires after 30 days (verified in Storage settings)
- [ ] Screen blur on iOS backgrounding confirmed via screenshot
- [ ] All interactive elements pass 4.5:1 contrast and 44pt tap target checks

---

## Phase 6 — Beta Prep (Weeks 11–12)

**Goal:** 50 couples in a closed beta. Monitoring, onboarding, and feedback loops in place.

### What to build

1. **PostHog analytics** — Self-hosted; instrument key events: `pairing_created`, `reveal_completed`, `journal_session_started`
2. **Marketing/landing page** — Simple web page at the Vercel domain: value prop, waitlist sign-up
3. **Beta invite system** — Admin-controlled allowlist on sign-up (Edge Function checks email against `beta_allowlist` table)
4. **In-app feedback** — "Send feedback" in settings; writes to a `feedback` table (no external service)
5. **Weekly safety review workflow** — Document the process; set a recurring calendar reminder
6. **Push notifications** (basic) — "Your partner tapped ready" via Expo Notifications + EAS

### Phase 6 AI Prompt

```
Task: Add beta controls, analytics, and push notifications.

1. Beta allowlist: create a beta_allowlist table (id, email text UNIQUE, invited_at, invited_by).
   In the root _layout.tsx auth flow, after session is confirmed, call an Edge Function
   'check-beta-access' that returns { allowed: boolean }. If false, show a friendly
   "You're on the waitlist — we'll be in touch" screen and sign the user out.

2. PostHog: install posthog-react-native. Initialize with the self-hosted PostHog URL
   (use EXPO_PUBLIC_POSTHOG_HOST env var). Track these events:
   - app_opened (on root layout mount, once per session)
   - pairing_created (on invite generated)
   - pairing_accepted (on accept)
   - reveal_triggered
   - reveal_completed (on computed state reached)
   - journal_session_started (on first message in a session)
   Do NOT track reveal content, journal content, or any desire data.

3. Push notifications: use Expo Notifications + EAS. Store the push token in profiles.push_token
   (add this column). When a reveal status changes to 'both_ready', the reveal-compute Edge
   Function should call Expo's push API to notify the partner: "Your partner is ready for a reveal."

4. In-app feedback: add "Send feedback" to settings. Simple modal: text input + send.
   Writes to feedback table (id, user_id, body, created_at). No external service.

Constraints: PostHog must never receive user_id, email, or any PII. Use a hashed identifier.
Push tokens must be stored server-side only; never log them.
```

### Phase 6 Done Criteria

- [ ] Beta allowlist blocks non-invited users
- [ ] PostHog receives events with no PII (verified in PostHog event stream)
- [ ] Push notification delivered when partner taps ready (tested on two real devices)
- [ ] 30-day retention, reveal completion rate, NPS tracked and reportable

---

## Prompting Strategy Summary

When handing any phase to an AI coding agent:

1. **Always include** `docs/TRD.md` + `docs/Backend_Schema.md` as context
2. **Include the relevant section** of `docs/Appflow.md` for navigation work
3. **Include the relevant section** of `docs/UI_UX_Design.md` for any screen work
4. **One phase at a time** — never combine phases in a single prompt
5. **End every prompt with** "TypeScript strict mode. No `any`. Follow the color palette and component patterns in docs/UI_UX_Design.md exactly."
6. **After each phase:** manually test on a real device before starting the next one

### Quick Reference — File → Phase

| File/Feature | Phase |
|-------------|-------|
| Supabase migration, CI, Sentry | 0 |
| Onboarding screens | 0 |
| Library list + rating UI | 1 |
| Item detail screen | 1 |
| Pairing invite + accept | 2 |
| Home pairing card | 2 |
| Reveal trigger + waiting | 3 |
| Reveal compute Edge Function | 3 |
| Mismatch bridge | 3 |
| Solo journal + AI coach | 4 |
| AI coach Edge Function | 4 |
| Passkey auth | 5 |
| Consent history screen | 5 |
| Therapist export | 5 |
| Beta allowlist | 6 |
| Push notifications | 6 |
| Analytics (PostHog) | 6 |

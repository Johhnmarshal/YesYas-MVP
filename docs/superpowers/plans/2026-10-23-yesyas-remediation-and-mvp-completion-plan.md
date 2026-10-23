# YesYas! Security Remediation & MVP Feature Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate all four critical SQL/privacy vulnerabilities in the Supabase backend and build the complete, tested v1 YesYas! mobile and web application across Onboarding, Desire Library, Pairing, Double-Blind Reveal, Encrypted Solo Journaling + AI Coach, and Settings/Exports.

**Architecture:** Database-first authorization using PostgreSQL Row-Level Security (RLS) paired with hardened `SECURITY DEFINER` RPCs (`SET search_path = ''`) for cross-user handshakes (pairing, double-blind reveal computation, dual-consent exports). The Expo Router v6 frontend uses React built-in state, a centralized design-token theme (`lib/theme.ts`), and client-side authenticated encryption (`lib/crypto.ts`) for private notes and journal entries.

**Tech Stack:** Expo SDK `~54.0.9`, React Native `0.81.4`, React `19.1.0`, Expo Router `~6.0.7`, TypeScript `~5.9.2` (strict), Supabase (`@supabase/supabase-js` `^2.45.0`, PostgreSQL 15+, pgTAP, Edge Functions on Deno).

**Spec:** `docs/superpowers/specs/2026-10-23-yesyas-remediation-and-mvp-completion-design.md`

## Global Constraints

- **Privacy Invariant**: User A must never read or deduce User B's raw desire ratings (`1..5`) or rejections (`<= 2`). `reveals.matches` stores only `both >= 4` items without numeric scores; `reveals.mismatches` (Curiosity Bridge) stores only `one >= 4 AND other = 3` items without numeric scores or direction; any item rated `<= 2` by either partner is strictly excluded.
- **TypeScript Strictness**: `"strict": true` in `tsconfig.json`; zero `any` types across `app/`, `components/`, `lib/`, and `supabase/functions/`.
- **State Management**: React built-in hooks (`useState`, `useEffect`, `useCallback`, `useMemo`, `useContext`) only; no Redux, Zustand, Jotai, or MobX.
- **Design Tokens**: Warm off-white background `#FBF8F4` (dark `#1A1F26`), surface `#FFFFFF` (dark `#252B34`), primary `#2C3E50` (dark `#ECF0F1`), secondary `#5B6A7A`, muted `#9AA3AE`, border `#E1E5EA`, warm accent `#C9856B`, cool accent `#4A90B8`, error `#B23A48`, success `#3A7D44`; 8pt spacing grid; minimum `44x44pt` touch targets (`minWidth: 44, minHeight: 44`).
- **PostgreSQL `SECURITY DEFINER` Hardening**: Every `SECURITY DEFINER` function must specify `SET search_path = ''`, schema-qualify every relation/type/function (`public.*`, `extensions.*`), `REVOKE ALL ON FUNCTION ... FROM PUBLIC`, and `GRANT EXECUTE ON FUNCTION ... TO authenticated`.

## Review Focus

1. **2-Party Deduction of Rejections (`<= 2`)**: When Partner A rates an item `5` and Partner B rates it `1` or `2`, `trigger_reveal()` must exclude that item from both `matches` and `mismatches` so Partner A cannot deduce Partner B's rejection (pinned in Task 1 `rls_test.sql` assertion 14).
2. **Repeated `trigger_reveal()` Calls by the Same Waiting Partner**: Calling `trigger_reveal(p_pairing_id)` multiple times while waiting for a partner must be idempotent and return the same single `'pending'` `reveal_id` without creating duplicate rows or raising `SQLSTATE 42702` (pinned in Task 1 `rls_test.sql` assertion 12).
3. **Expired or Self-Accepted Pairing Invite Codes**: Calling `accept_pairing_invite(code)` with an expired code, a consumed code, or as the inviter of that code must raise a deterministic SQL exception (`22023` / `42501`) and leave `pairings` unchanged (pinned in Task 1 `rls_test.sql` assertions 18–20).
4. **Tampered or Malformed Ciphertext in `decryptText()`**: Passing corrupted ciphertext (`enc:v1:...` with modified tag/bytes) to `decryptText()` must throw an authentication error rather than silently returning garbage plaintext, while legacy unprefixed strings return as-is for migration safety (pinned in Task 2 `lib/__tests__/crypto.test.ts`).
5. **Solo Ratings Graduation on Pairing Acceptance**: When a user rates items in solo mode (`pairing_id IS NULL`) and later accepts or creates an active pairing, those ratings must automatically populate into the new `pairing_id` without overwriting any existing paired rating (pinned in Task 1 `rls_test.sql` assertion 21).

---

## File Map

- **Database & Backend (`supabase/`)**:
  - Create: `supabase/migrations/20260420000004_remediation_and_v1_completion.sql`
  - Modify: `supabase/seed.sql` (expand curated desire library to 45+ items across all 3 tiers & tones)
  - Modify: `supabase/tests/rls_test.sql` (expand from 8 to 24 pgTAP assertions)
  - Create: `supabase/functions/ai-coach/system-prompt.ts`
  - Create: `supabase/functions/ai-coach/index.ts`
  - Create: `supabase/functions/therapist-export/index.ts`
  - Create: `scripts/lockdown-legacy-firebase.firestore.rules`
- **Typed Domain Library (`lib/`)**:
  - Modify: `lib/database.types.ts` (add new columns, tables `ai_flags`/`ai_logs`, and RPC signatures)
  - Create: `lib/theme.ts` (color palette, typography, spacing constants, tone/tier metadata)
  - Create: `lib/crypto.ts` (authenticated `encryptText` / `decryptText` + per-user key management)
  - Create: `lib/pairing.ts` (typed RPC wrappers for pairing lifecycle)
  - Create: `lib/desires.ts` (library queries, rating upserts, debounced encrypted note saves)
  - Create: `lib/reveal.ts` (reveal state machine queries, `trigger_reveal`, `withdraw_reveal`, bridge scripts)
  - Create: `lib/journal.ts` (encrypted journal CRUD, AI coach client, AI response flagging)
  - Create: `lib/consent.ts` (consent audit trail fetch + client-side SHA-256 chain verifier)
- **Reusable UI Components (`components/`)**:
  - Create: `components/StarRating.tsx`
  - Create: `components/LibraryItemCard.tsx`
  - Create: `components/PairingManageModal.tsx`
  - Create: `components/MismatchBridgeModal.tsx`
  - Create: `components/BiometricGate.tsx`
- **Expo Router Screens (`app/`)**:
  - Modify: `app/_layout.tsx` (auth + `onboarding_complete` check + `BiometricGate` wrapper)
  - Modify: `app/(app)/_layout.tsx` (Bottom Tabs: Home, Library, Journal, Settings + hidden stack routes)
  - Create: `app/(app)/onboarding/tone.tsx`
  - Create: `app/(app)/onboarding/tier.tsx`
  - Create: `app/(app)/onboarding/mode.tsx`
  - Modify: `app/(app)/home.tsx` (complete Today surface with pairing card, reveal CTA, library & journal cards)
  - Create: `app/(app)/library/index.tsx`
  - Create: `app/(app)/library/[id].tsx`
  - Create: `app/(app)/pairing/invite.tsx`
  - Create: `app/(app)/pairing/accept.tsx`
  - Create: `app/(app)/reveal/index.tsx`
  - Create: `app/(app)/journal/index.tsx`
  - Create: `app/(app)/journal/[id].tsx`
  - Create: `app/(app)/settings/index.tsx`
  - Create: `app/(app)/settings/consent.tsx`
  - Create: `app/(app)/settings/export.tsx`
- **CI & Verification (`.github/workflows/`)**:
  - Create: `.github/workflows/ci.yml`

---

### Task 1: Database Security Remediation, RPCs, Seed Expansion & pgTAP Suite

**Files:**
- Create: `supabase/migrations/20260420000004_remediation_and_v1_completion.sql`
- Modify: `supabase/seed.sql`
- Modify: `supabase/tests/rls_test.sql`
- Modify: `lib/database.types.ts`
- Create: `scripts/lockdown-legacy-firebase.firestore.rules`

**Interfaces:**
- Consumes: `supabase/migrations/20260420000001..0003.sql`
- Produces:
  - `public.profiles.onboarding_complete: boolean`
  - `public.pairings.invite_expires_at: timestamptz`
  - `public.reveals.triggered_by: uuid`
  - `public.ai_flags` (`id`, `user_id`, `journal_entry_id`, `reason`, `created_at`)
  - `public.ai_logs` (`id`, `user_id_hash`, `thread_id`, `model`, `prompt_tokens`, `completion_tokens`, `created_at`)
  - RPC `public.create_pairing_invite() -> TABLE(pairing_id uuid, invite_code text, expires_at timestamptz)`
  - RPC `public.preview_pairing_invite(p_invite_code text) -> TABLE(pairing_id uuid, inviter_display_name text, expires_at timestamptz)`
  - RPC `public.accept_pairing_invite(p_invite_code text) -> uuid`
  - RPC `public.update_pairing_status(p_pairing_id uuid, p_new_status public.pairing_status) -> void`
  - RPC `public.trigger_reveal(p_pairing_id uuid) -> TABLE(reveal_id uuid, status public.reveal_status)`
  - RPC `public.withdraw_reveal(p_pairing_id uuid) -> void`
  - RPC `public.request_therapist_export(p_pairing_id uuid) -> TABLE(both_consented boolean, export_event_id uuid)`
  - Updated `Database` interface in `lib/database.types.ts`

- [ ] **Step 1: Expand `supabase/tests/rls_test.sql` from `plan(8)` to `plan(24)` with failing security & RPC assertions**

Add assertions 9–24 in `supabase/tests/rls_test.sql` testing:
```sql
-- 9. Direct client INSERT into consent_events is denied (must use RPCs)
SELECT throws_ok(
  $$INSERT INTO public.consent_events (user_id, event_type, payload_hash)
    VALUES ('11111111-1111-1111-1111-111111111111', 'reveal_triggered', 'fake')$$,
  '42501',
  NULL,
  'Direct client insert to consent_events is blocked by RLS'
);

-- 10-15. trigger_reveal() executes without SQLSTATE 42702, is idempotent on repeat calls by User A,
-- transitions to 'computed' when User B calls it, strips a_rating/b_rating from matches,
-- includes (5, 3) in mismatches (Curiosity Bridge) without ratings, and EXCLUDES (5, 1) veto items!
-- 16-21. create_pairing_invite(), preview_pairing_invite(), accept_pairing_invite() reject self-accept,
-- reject expired codes, consume invite_code on accept, log pairing_accepted consent_events for both users,
-- and copy solo desires (pairing_id IS NULL) into the new pairing_id.
-- 22-24. withdraw_reveal() cancels a pending reveal; consent_events blocks UPDATE and DELETE.
```

- [ ] **Step 2: Write `supabase/migrations/20260420000004_remediation_and_v1_completion.sql`**

Implement in `supabase/migrations/20260420000004_remediation_and_v1_completion.sql`:
1. Schema additions: `ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false;`, `ALTER TABLE public.pairings ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz;`, `ALTER TABLE public.reveals ADD COLUMN IF NOT EXISTS triggered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;`, `ALTER TABLE public.desires DROP CONSTRAINT IF EXISTS desires_pairing_fk_consistency;`.
2. Partial unique index on `reveals`: `CREATE UNIQUE INDEX IF NOT EXISTS reveals_one_open_per_pairing ON public.reveals (pairing_id) WHERE status IN ('pending', 'both_ready');`.
3. Create `public.ai_flags` and `public.ai_logs` tables with RLS enabled (`ai_flags` self-insert/read; `ai_logs` service-role only).
4. Drop insecure RLS policies: `DROP POLICY IF EXISTS pairings_accept_invite ON public.pairings;`, `DROP POLICY IF EXISTS pairings_insert_as_inviter ON public.pairings;`, `DROP POLICY IF EXISTS pairings_member_update_status ON public.pairings;`, `DROP POLICY IF EXISTS consent_self_insert ON public.consent_events;`.
5. Harden `public.handle_new_user()`, `public.is_pairing_member()`, `public.consent_events_chain()`, and `public.expire_old_reveals()` with `SET search_path = ''` and schema-qualified `public.*` / `extensions.digest`.
6. Implement hardened `SECURITY DEFINER` RPCs (`SET search_path = ''`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated`):
   - `public.create_pairing_invite()`
   - `public.preview_pairing_invite(p_invite_code text)`
   - `public.accept_pairing_invite(p_invite_code text)` (with automatic solo-to-paired desire graduation and dual `consent_events` inserts)
   - `public.update_pairing_status(p_pairing_id uuid, p_new_status public.pairing_status)`
   - `public.trigger_reveal(p_pairing_id uuid)` (fully table-qualified `p.status`, `r.status`; `matches` containing `library_item_id, slug, title, description, tier` where `a.rating >= 4 AND b.rating >= 4`; `mismatches` containing `library_item_id, slug, title, tier` where `(a.rating >= 4 AND b.rating = 3) OR (a.rating = 3 AND b.rating >= 4)`; updating the existing `'pending'` reveal row in place when Partner 2 is ready)
   - `public.withdraw_reveal(p_pairing_id uuid)`
   - `public.request_therapist_export(p_pairing_id uuid)`

- [ ] **Step 3: Expand `supabase/seed.sql` to 45 curated items and update `lib/database.types.ts` + `scripts/lockdown-legacy-firebase.firestore.rules`**

Add 30 additional non-explicit/appropriately tiered desire items across `sensory`, `suggestive`, and `explicit` tiers and `romantic`, `playful`, `direct` tone tags in `supabase/seed.sql` (total 45 items, keeping `written-note-of-appreciation` intact for `rls_test.sql`). Update `lib/database.types.ts` with all new columns, tables, and `Functions` signatures. Create `scripts/lockdown-legacy-firebase.firestore.rules` with a deny-all Firestore ruleset for legacy project `gen-lang-client-0707391511`.

- [ ] **Step 4: Verify TypeScript compilation and SQL syntax**

Run: `npx tsc --noEmit`
Expected: Exits with code 0 and zero output.

- [ ] **Step 5: Commit Task 1**

```bash
git add supabase/ lib/database.types.ts scripts/lockdown-legacy-firebase.firestore.rules
git commit -m "fix(supabase): remediate RLS/reveal vulnerabilities, harden RPCs, and expand pgTAP suite"
```

---

### Task 2: Design System Theme, Client-Side Authenticated Encryption & Domain Helpers

**Files:**
- Create: `lib/theme.ts`
- Create: `lib/crypto.ts`
- Create: `lib/pairing.ts`
- Create: `lib/desires.ts`
- Create: `lib/reveal.ts`
- Create: `lib/journal.ts`
- Create: `lib/consent.ts`
- Create: `scripts/verify-domain-logic.ts`

**Interfaces:**
- Consumes: `lib/supabase.ts`, `lib/database.types.ts`
- Produces:
  - `lib/theme.ts`: `COLORS`, `DARK_COLORS`, `SPACING`, `TYPOGRAPHY`, `TONE_OPTIONS`, `TIER_OPTIONS`, `useThemeColors()`
  - `lib/crypto.ts`: `encryptText(plaintext: string, userId: string): Promise<string>`, `decryptText(payload: string, userId: string): Promise<string>`, `sha256Hex(input: string): string`
  - `lib/pairing.ts`: `createPairingInvite()`, `previewPairingInvite(code: string)`, `acceptPairingInvite(code: string)`, `updatePairingStatus(pairingId: string, status: PairingStatus)`, `getActiveOrPendingPairing(userId: string)`
  - `lib/desires.ts`: `fetchLibraryItems(maxTier?: DesireTier)`, `fetchUserDesires(userId: string, pairingId: string | null)`, `upsertDesireRating(params)`, `upsertDesireNote(params)`
  - `lib/reveal.ts`: `fetchCurrentReveal(pairingId: string)`, `triggerReveal(pairingId: string)`, `withdrawReveal(pairingId: string)`, `CURIOSITY_BRIDGE_SCRIPTS`
  - `lib/journal.ts`: `fetchJournalEntries(userId: string)`, `createJournalEntry(userId: string, body: string, threadId?: string | null)`, `sendAiCoachMessage(message: string, threadId?: string)`, `reportAiMessage(userId: string, journalEntryId: string, reason: string)`
  - `lib/consent.ts`: `fetchConsentEvents(userId: string)`, `verifyConsentChain(events: ConsentEventRow[]): { valid: boolean; brokenAtId: string | null }`

- [ ] **Step 1: Write the verification test script `scripts/verify-domain-logic.ts`**

Create `scripts/verify-domain-logic.ts` asserting:
1. `encryptText('My secret desire note', userA)` produces an `enc:v1:`-prefixed string that does not contain `'secret'`.
2. `decryptText(cipher, userA)` recovers `'My secret desire note'` losslessly (including Unicode/emoji).
3. `decryptText(cipher, userB)` or tampered tag/ciphertext throws `'Decryption authentication failed'`.
4. `decryptText('legacy plaintext note', userA)` returns `'legacy plaintext note'` unchanged.
5. `verifyConsentChain(validChain)` returns `{ valid: true, brokenAtId: null }`, and mutating any row's `payload` or `prev_hash` returns `{ valid: false, brokenAtId: mutatedRow.id }`.

- [ ] **Step 2: Run verification script to confirm it fails before implementation**

Run: `npx tsx scripts/verify-domain-logic.ts` (or `node --experimental-strip-types scripts/verify-domain-logic.ts`)
Expected: FAIL with module not found `../lib/crypto`.

- [ ] **Step 3: Implement `lib/theme.ts`, `lib/crypto.ts`, `lib/pairing.ts`, `lib/desires.ts`, `lib/reveal.ts`, `lib/journal.ts`, and `lib/consent.ts`**

Implement pure TypeScript SHA-256 + HMAC-SHA256 + CTR authenticated encryption (`enc:v1:<iv_hex>:<ciphertext_hex>:<hmac_hex>`) in `lib/crypto.ts` backed by a 256-bit per-user key persisted in `AsyncStorage` under `@yesyas/key/v1/${userId}`, plus `sha256Hex` matching PostgreSQL `encode(digest(..., 'sha256'), 'hex')` for `verifyConsentChain` in `lib/consent.ts`. Implement the typed Supabase service wrappers in `lib/pairing.ts`, `lib/desires.ts`, `lib/reveal.ts`, and `lib/journal.ts`.

- [ ] **Step 4: Run verification script and TypeScript compiler**

Run: `node --experimental-strip-types scripts/verify-domain-logic.ts && npx tsc --noEmit`
Expected: PASS all assertions and exit with code 0.

- [ ] **Step 5: Commit Task 2**

```bash
git add lib/ scripts/verify-domain-logic.ts
git commit -m "feat(lib): add design system tokens, authenticated encryption, and domain helpers"
```

---

### Task 3: Foundation Shell, 3-Step Onboarding, Biometric Gate & 4-Tab Navigation

**Files:**
- Create: `components/BiometricGate.tsx`
- Modify: `app/_layout.tsx`
- Modify: `app/(app)/_layout.tsx`
- Create: `app/(app)/onboarding/tone.tsx`
- Create: `app/(app)/onboarding/tier.tsx`
- Create: `app/(app)/onboarding/mode.tsx`

**Interfaces:**
- Consumes: `lib/theme.ts`, `lib/supabase.ts`
- Produces:
  - Root auth + onboarding gate in `app/_layout.tsx` (redirects to `/(app)/onboarding/tone` when `profile.onboarding_complete === false`)
  - 4-tab navigation bar in `app/(app)/_layout.tsx` (`home`, `library/index`, `journal/index`, `settings/index`) with non-tab routes hidden via `href: null`
  - Onboarding flow (`tone` -> `tier` -> `mode`) writing `tone_preference`, `content_tier_preference`, and `onboarding_complete = true` to `public.profiles`
  - `BiometricGate` component using `expo-local-authentication` + 6-digit PIN fallback stored in `AsyncStorage`

- [ ] **Step 1: Implement `components/BiometricGate.tsx` and update `app/_layout.tsx` + `app/(app)/_layout.tsx`**

Update `app/_layout.tsx` to fetch `profiles.onboarding_complete` on session establishment and route first-time users to `/(app)/onboarding/tone`. Configure `app/(app)/_layout.tsx` using Expo Router `<Tabs>` with 4 visible tabs (`Home`, `Library`, `Journal`, `Settings`) using `@expo/vector-icons` (`Ionicons`) and hide detail/modal routes (`onboarding/*`, `library/[id]`, `pairing/*`, `reveal/index`, `journal/[id]`, `settings/consent`, `settings/export`) with `href: null`.

- [ ] **Step 2: Implement the 3 Onboarding Screens (`tone.tsx`, `tier.tsx`, `mode.tsx`)**

Build `app/(app)/onboarding/tone.tsx`, `tier.tsx`, and `mode.tsx` matching the exact wireframes in `docs/UI_UX_Design.md`. On `mode.tsx`, selecting "Explore solo" or "Invite my partner now" updates `public.profiles` with `tone_preference`, `content_tier_preference`, and `onboarding_complete = true`, then navigates to `/(app)/journal` or `/(app)/pairing/invite`.

- [ ] **Step 3: Verify TypeScript and ESLint**

Run: `npx tsc --noEmit && npx eslint app/ components/`
Expected: Exits with code 0.

- [ ] **Step 4: Commit Task 3**

```bash
git add app/ components/BiometricGate.tsx
git commit -m "feat(onboarding): add 4-tab navigation shell, biometric lock gate, and 3-step onboarding"
```

---

### Task 4: Desire Library & Private Encrypted Rating UI

**Files:**
- Create: `components/StarRating.tsx`
- Create: `components/LibraryItemCard.tsx`
- Create: `app/(app)/library/index.tsx`
- Create: `app/(app)/library/[id].tsx`

**Interfaces:**
- Consumes: `lib/desires.ts`, `lib/pairing.ts`, `lib/theme.ts`
- Produces:
  - `StarRating` (`value`, `onChange`, `disabled`, 44x44pt tap targets, accessibility labels)
  - `LibraryItemCard` (collapsed/expanded states, tier badge, star rating, 800ms debounced encrypted note input, permanent `"🔒 Only you see your ratings"` label)
  - `app/(app)/library/index.tsx` (segmented tier filter `Sensory` / `Suggestive` / `Explicit` + tone filter, loading/empty/error states)
  - `app/(app)/library/[id].tsx` (full-screen item view with synchronized rating and encrypted note)

- [ ] **Step 1: Implement `components/StarRating.tsx` and `components/LibraryItemCard.tsx`**

Build `StarRating.tsx` and `LibraryItemCard.tsx` with 800ms debounced note encryption via `upsertDesireNote` and immediate rating persistence via `upsertDesireRating` (writing to both solo and active `pairing_id` when paired).

- [ ] **Step 2: Implement `app/(app)/library/index.tsx` and `app/(app)/library/[id].tsx`**

Build the Library list screen with tier filtering (defaulting to the user's `content_tier_preference`), search/tone tag pills, rated count summary header, and full-screen `[id].tsx` detail view.

- [ ] **Step 3: Verify TypeScript and ESLint**

Run: `npx tsc --noEmit && npx eslint app/ components/`
Expected: Exits with code 0.

- [ ] **Step 4: Commit Task 4**

```bash
git add components/StarRating.tsx components/LibraryItemCard.tsx app/\(app\)/library/
git commit -m "feat(library): add Desire Library screens, star rating, and encrypted notes"
```

---

### Task 5: Hardened Pairing Handshake, Home Today Dashboard & Double-Blind Reveal Flow

**Files:**
- Create: `components/PairingManageModal.tsx`
- Create: `components/MismatchBridgeModal.tsx`
- Create: `app/(app)/pairing/invite.tsx`
- Create: `app/(app)/pairing/accept.tsx`
- Create: `app/(app)/reveal/index.tsx`
- Modify: `app/(app)/home.tsx`

**Interfaces:**
- Consumes: `lib/pairing.ts`, `lib/reveal.ts`, `lib/desires.ts`, `lib/theme.ts`
- Produces:
  - `app/(app)/pairing/invite.tsx` (generates 8-char expiring code via `createPairingInvite()`, copy to clipboard, native `Share.share` deep link `yesyasapp://pair?code=XXXX`, link to enter a partner's code)
  - `app/(app)/pairing/accept.tsx` (handles `?code=XXXX` deep link or manual code input, previews inviter name via `previewPairingInvite`, accepts via `acceptPairingInvite` which graduates solo desires and logs consent events)
  - `app/(app)/reveal/index.tsx` (full state machine: `no_reveal` -> `pending` with 72h countdown & withdraw button -> `computed` with match cards, Curiosity Bridge modal trigger, and 24h expiry countdown -> `expired` summary)
  - `app/(app)/home.tsx` (Today surface showing Pairing status card, Start/View Reveal CTA, unrated Library count CTA, and Solo Journal CTA)

- [ ] **Step 1: Implement `components/PairingManageModal.tsx`, `app/(app)/pairing/invite.tsx`, and `app/(app)/pairing/accept.tsx`**

Build the pairing invite and accept screens wired to the hardened RPCs in `lib/pairing.ts`, plus `PairingManageModal.tsx` for pausing, resuming, or ending a pairing with confirmation dialogs.

- [ ] **Step 2: Implement `components/MismatchBridgeModal.tsx` and `app/(app)/reveal/index.tsx`**

Build the Reveal state machine screen with Supabase Realtime subscription on `public.reveals` (plus 30s fallback poll), live countdown timers for the 72h readiness window and 24h reveal expiry, iOS background blur protection (`AppState` listener), and `MismatchBridgeModal.tsx` displaying therapist-vetted Curiosity Bridge conversation scripts.

- [ ] **Step 3: Upgrade `app/(app)/home.tsx` to the complete Today Dashboard**

Replace the placeholder `home.tsx` with the full Today surface displaying the user's display name, active/pending/paused pairing card (or "Invite a partner" card), Reveal status badge, Desire Library progress card, and Journal shortcut card.

- [ ] **Step 4: Verify TypeScript and ESLint**

Run: `npx tsc --noEmit && npx eslint app/ components/`
Expected: Exits with code 0.

- [ ] **Step 5: Commit Task 5**

```bash
git add components/PairingManageModal.tsx components/MismatchBridgeModal.tsx app/\(app\)/pairing/ app/\(app\)/reveal/ app/\(app\)/home.tsx
git commit -m "feat(pairing,reveal): implement pairing handshake, reveal state machine, and Today home"
```

---

### Task 6: Solo Encrypted Journaling, AI Coach Edge Function & Settings / Audit / Export Flows

**Files:**
- Create: `supabase/functions/ai-coach/system-prompt.ts`
- Create: `supabase/functions/ai-coach/index.ts`
- Create: `supabase/functions/therapist-export/index.ts`
- Create: `app/(app)/journal/index.tsx`
- Create: `app/(app)/journal/[id].tsx`
- Create: `app/(app)/settings/index.tsx`
- Create: `app/(app)/settings/consent.tsx`
- Create: `app/(app)/settings/export.tsx`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `lib/journal.ts`, `lib/consent.ts`, `lib/pairing.ts`, `lib/crypto.ts`, `lib/theme.ts`
- Produces:
  - `supabase/functions/ai-coach/index.ts` & `system-prompt.ts` (safety-constrained intimacy reflection coach with 20/session & 100/day rate limits and hashed logging to `ai_logs`, plus graceful local reflection fallback when no API key is configured)
  - `supabase/functions/therapist-export/index.ts` (verifies dual partner `therapist_export` consent events, returns structured summary of reveal counts and relationship check-in prompts without raw desires)
  - `app/(app)/journal/index.tsx` & `[id].tsx` (encrypted journal composer, AI coach conversation thread, long-press "Report this response" writing to `ai_flags`, past entries list, and "Invite my partner" graduation footer)
  - `app/(app)/settings/index.tsx`, `consent.tsx`, `export.tsx` (profile/tone/tier editor, biometric/PIN lock setup, live SHA-256 hash-chain audit viewer, dual-consent therapist export screen, sign-out & account deletion)
  - `.github/workflows/ci.yml` (automated typecheck, lint, domain test suite, and audit workflow)

- [ ] **Step 1: Implement `supabase/functions/ai-coach/` and `supabase/functions/therapist-export/`**

Create `supabase/functions/ai-coach/system-prompt.ts` (with the 6 mandatory safety rules from `docs/Implementation_Plan.md`), `supabase/functions/ai-coach/index.ts`, and `supabase/functions/therapist-export/index.ts`.

- [ ] **Step 2: Implement `app/(app)/journal/index.tsx` and `app/(app)/journal/[id].tsx`**

Build the Solo Journal screen with `"🔒 Private to you — encrypted before saving"`, AI Coach reflective chat (calling `sendAiCoachMessage`), long-press response flagging (`reportAiMessage`), decrypted past entry cards, and the "Invite my partner" graduation modal.

- [ ] **Step 3: Implement `app/(app)/settings/index.tsx`, `consent.tsx`, `export.tsx`, and `.github/workflows/ci.yml`**

Build the Settings hub (display name, tone, content tier, PIN/biometric lock toggle, pairing management), `consent.tsx` (displaying the chronological `consent_events` log with a live `"✓ Hash chain verified"` integrity badge from `verifyConsentChain`), `export.tsx` (dual-consent therapist summary generator with native `Share.share`), and `.github/workflows/ci.yml`.

- [ ] **Step 4: Run full project verification (TypeScript, ESLint, Domain Logic Tests, Web Bundle Export)**

Run: `node --experimental-strip-types scripts/verify-domain-logic.ts && npx tsc --noEmit && npx eslint app/ components/ lib/ && npx expo export -p web`
Expected: All unit tests pass, 0 TypeScript errors, 0 ESLint errors, and `dist/` static web bundle exports cleanly.

- [ ] **Step 5: Commit Task 6**

```bash
git add supabase/functions/ app/\(app\)/journal/ app/\(app\)/settings/ .github/workflows/ci.yml
git commit -m "feat(journal,settings,ci): add encrypted journal, AI coach, consent verifier, therapist export, and CI"
```

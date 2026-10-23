# YesYas! v1 — Security Remediation & MVP Feature Completion Design Specification

**Date:** 2026-10-23  
**Status:** Approved for Planning  
**Canonical Stack:** Expo SDK 54 (React Native 0.81, React 19, Expo Router v6, TypeScript 5.9 strict) + Supabase (PostgreSQL 15+, pgTAP, Edge Functions, Realtime, Auth)

---

## 1. Intent & The Why

YesYas! is a privacy-first intimacy application for couples and solo users exploring what they want without the vulnerability of asking directly. Its entire value proposition rests on a single non-negotiable invariant:

> **User A must never be able to read or deduce User B's unshared desires or rejections ("No" ratings).**

Prior to repository unification (`ee614b8`), YesYas! existed as two split codebases:
1. **Legacy Web Prototype (`v0.1-web-prototype` / `v0.2-web-prototype-hardened`)**: A Vite + React + Firebase/Firestore web app generated in Google AI Studio. It had UI components for a dashboard, pairing flow, and mock 5-item desire library, but lacked server-side double-blind matching and suffered from Firestore rule vulnerabilities.
2. **Canonical Product (`main` branch)**: An Expo (React Native + Web) + Supabase application with comprehensive product, technical, schema, and UI/UX specifications (`docs/PRD.md`, `docs/TRD.md`, `docs/Backend_Schema.md`, `docs/Appflow.md`, `docs/UI_UX_Design.md`) and initial SQL migrations (`supabase/migrations/20260420000001..0003`), but only a 2-screen UI scaffold (`sign-in.tsx` and placeholder `home.tsx`) and four severe defects in the SQL layer that break the privacy invariant and runtime execution.

This design specification defines:
1. **Immediate Security & SQL Layer Remediation**: Fixing all four verified SQL/RLS defects in the Supabase backend plus closing information-theoretic privacy leaks in the reveal engine.
2. **End-to-End MVP Feature Completion**: Completing all user-facing flows across Onboarding, Desire Library & Encrypted Notes, Hardened Pairing Handshake, Double-Blind Reveal & Curiosity Bridge, Solo Encrypted Journaling with AI Coach, and Settings / Consent Audit / Therapist Export.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
1. **Enforce the Privacy Invariant in Code & SQL**: Ensure raw ratings (`1..5`) and rejections (`<= 2`) are never stored in shared tables (`reveals`) or deducible via 2-party game elimination.
2. **Eliminate All Runtime SQL Bugs**: Fix the deterministic `SQLSTATE 42702` ambiguous `status` error in `trigger_reveal()`, add missing partial unique indexes on `reveals`, and replace the broken client-side `pairings` update policy with hardened `SECURITY DEFINER` RPCs.
3. **Implement Real Application-Layer Encryption**: Encrypt `desires.note` and `journal_entries.body` using authenticated AES-256-GCM before any network write.
4. **Deliver the Complete 4-Tab Expo App**: Build out the full navigation tree (`Home`, `Library`, `Journal`, `Settings`), 3-step onboarding (`tone`, `tier`, `mode`), pairing invite/accept flows, real-time reveal state machine, AI coach Edge Function, and therapist summary export.
5. **Prove Security with Automated Tests**: Expand `supabase/tests/rls_test.sql` (pgTAP) from 8 to 24+ assertions covering RLS, RPC authorization, reveal non-leakage, and hash-chain immutability, alongside Jest/unit tests for client crypto and state logic.

### Non-Goals (Out of Scope for v1)
- Multi-partner / polyamorous simultaneous active pairings (v1 enforces at most one `active` pairing per user via partial unique indexes).
- User-authored custom desire items (v1 library is strictly curated and read-only).
- In-app couple messaging or chat (the app facilitates real-life conversation via scripts, not a chat client).
- Stripe / subscription billing (v1 launches free for the 50-couple beta).
- Firebase / Firestore maintenance (the legacy Firebase project `gen-lang-client-0707391511` will be locked down with a deny-all `firestore.rules` tombstone; all development is exclusively on Expo + Supabase).

### Anti-Goals (What Would Make This a Failure Even If It Technically Works)
- **Leaking a "No" via Mismatch Bridges**: In a 2-player game where each user knows their own rating, surfacing a specific `library_item_id` as a `(>= 4, <= 2)` mismatch lets the `>= 4` rater immediately deduce with 100% certainty that their partner rated `<= 2` ("No"), and lets the `<= 2` rater know their partner rated `>= 4`. **Any feature that allows a user to deduce that their partner said "No" (`<= 2`) to a specific item is a critical product failure.**
- **Silent Security Downgrades**: Falling back to plaintext when encryption fails, or allowing client-side inserts to forge `consent_events`.
- **Clinical or Cold UX**: Failing to show visible privacy reassurances (`🔒 Only you see your ratings`) on rating and journaling screens.

---

## 3. Global Constraints

From `docs/TRD.md`, `docs/Backend_Schema.md`, and `docs/UI_UX_Design.md`:
- **Framework & Language**: Expo SDK `~54.0.9`, React Native `0.81.4`, React `19.1.0`, Expo Router `~6.0.7`, TypeScript `~5.9.2` with `"strict": true`. Zero `any` types.
- **State Management**: React built-in hooks (`useState`, `useEffect`, `useCallback`, `useMemo`, `useContext`) only. Do not install Redux, Zustand, Jotai, or MobX.
- **Styling**: React Native `StyleSheet.create` using the exact design system tokens in `docs/UI_UX_Design.md`:
  - `bg`: `#FBF8F4` (dark: `#1A1F26`)
  - `surface`: `#FFFFFF` (dark: `#252B34`)
  - `primary`: `#2C3E50` (dark: `#ECF0F1`)
  - `secondary`: `#5B6A7A` (dark: `#A0AAB4`)
  - `muted`: `#9AA3AE` (dark: `#6C7A89`)
  - `border`: `#E1E5EA` (dark: `#343D4B`)
  - `accentWarm`: `#C9856B`
  - `accentCool`: `#4A90B8`
  - `error`: `#B23A48`
  - `success`: `#3A7D44`
- **Accessibility**: Minimum `44x44pt` touch targets (`minHeight: 44, minWidth: 44`), `accessibilityRole` and `accessibilityLabel` on all interactive controls, WCAG 2.1 AA contrast (`>= 4.5:1`).
- **Database Security**: Every `SECURITY DEFINER` function in PostgreSQL must set `SET search_path = ''`, fully qualify all schema references (`public.table_name`, `extensions.digest`), `REVOKE ALL ON FUNCTION ... FROM PUBLIC`, and `GRANT EXECUTE ON FUNCTION ... TO authenticated`.

---

## 4. Technical Remediation Architecture (Fixing the Review Findings)

### 4.1 Remediation of Claim 1: `SQLSTATE 42702` Ambiguous `status` in `trigger_reveal()`
- **Root Cause**: `public.trigger_reveal(p_pairing_id uuid)` declares `RETURNS TABLE (reveal_id uuid, status reveal_status)`. In PL/pgSQL, output column names are implicit local variables. Inside the body, `WHERE id = p_pairing_id AND status = 'active'` and `WHERE pairing_id = p_pairing_id AND status = 'pending'` collide with the output variable `status`, raising `column reference "status" is ambiguous (SQLSTATE 42702)` at runtime.
- **Fix (Builder Call)**:
  - Table-qualify every column reference in all queries inside `trigger_reveal` (`p.status`, `r.status`, `d.rating`, `rr.ready_at`).
  - Alias the output columns or assign explicitly via `RETURN QUERY SELECT v_reveal_id AS reveal_id, 'computed'::public.reveal_status AS status;`.

### 4.2 Remediation of Claim 2: Raw Rating Leaks & Information-Theoretic Mismatch Leak
- **Root Cause 1**: `trigger_reveal()` writes `jsonb_build_object('library_item_id', library_item_id, 'a_rating', a_rating, 'b_rating', b_rating)` into `reveals.matches` and `reveals.mismatches`, directly exposing both users' raw numeric ratings (`1..5`) to both partners.
- **Root Cause 2 (Information-Theoretic Leak)**: Even if numeric ratings are stripped from `mismatches`, defining a mismatch as `(a_rating >= 4 AND b_rating <= 2) OR (a_rating <= 2 AND b_rating >= 4)` and listing the `library_item_id` allows each partner (who knows their own rating) to immediately deduce that the other partner rated `<= 2` ("No") or `>= 4` ("Yes").
- **Fix (Builder Call — Privacy-Preserving "Curiosity Bridge")**:
  1. **Hard Veto on `<= 2`**: Any item where *either* partner rated `1` or `2` is a hard veto and is **never** included in `matches` or `mismatches`. Neither partner ever learns which items the other rated `1` or `2`.
  2. **Matches (`both >= 4`)**: `reveals.matches` contains only `[{ "library_item_id": uuid, "slug": text, "title": text, "description": text, "tier": desire_tier }]`. Raw ratings (`4` vs `5`) are never stored in `reveals`.
  3. **Curiosity Bridge (`one >= 4 AND other = 3`)**: `reveals.mismatches` is redefined as a **Curiosity Bridge** — items where one partner rated `>= 4` (enthusiastic) and the other rated `3` (curious / maybe / open to talking), and **neither** rated `<= 2`. Each entry stores `[{ "library_item_id": uuid, "slug": text, "title": text, "tier": desire_tier }]` with **no** `a_rating`, `b_rating`, or `direction` field. Even if a user deduces their partner's rating from their own, the only thing they can ever learn is that their partner is *at least curious (`>= 3`)* — never a rejection!
  4. **Expiry Sweeper (`expire_old_reveals`)**: Nulls out `matches` and `mismatches` after 24 hours and writes `summary = jsonb_build_object('match_count', ..., 'mismatch_count', ..., 'expired_at', now())`.

### 4.3 Remediation of Claim 3: `ON CONFLICT DO NOTHING` & Reveal State Transitions
- **Root Cause**: `reveals` had no unique constraint on pending reveals per pairing, so `INSERT INTO public.reveals (pairing_id, status) VALUES (p_pairing_id, 'pending') ON CONFLICT DO NOTHING` inserted duplicate `'pending'` rows on every call, and when the second user became ready, `trigger_reveal` inserted a brand-new `'computed'` row while leaving the `'pending'` row open forever.
- **Fix (Builder Call)**:
  1. Add `triggered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL` to `public.reveals` (matching `docs/Backend_Schema.md`).
  2. Create partial unique index:
     ```sql
     CREATE UNIQUE INDEX reveals_one_open_per_pairing
       ON public.reveals (pairing_id)
       WHERE status IN ('pending', 'both_ready');
     ```
  3. Update `trigger_reveal(p_pairing_id uuid)`:
     - When Partner 1 calls `trigger_reveal`: upserts the single open reveal row for `p_pairing_id` with `status = 'pending'`, `triggered_by = v_user`.
     - When Partner 2 calls `trigger_reveal` within the 72h readiness window: updates that existing open reveal row in place (`UPDATE public.reveals r SET status = 'computed', both_ready_at = now(), revealed_at = now(), expires_at = now() + interval '24 hours', matches = v_matches, mismatches = v_mismatches WHERE r.id = v_reveal_id`) and deletes the consumed `reveal_readiness` rows for `p_pairing_id`.
  4. Add `withdraw_reveal(p_pairing_id uuid)` RPC so the waiting partner can cancel their pending reveal (as required by `docs/Appflow.md` line 156: `[Withdraw my reveal]`).

### 4.4 Remediation of Claim 4: Hardened Pairing Handshake & Solo Desire Graduation
- **Root Cause**:
  1. `pairings_accept_invite` RLS policy (`USING (status = 'pending' AND invitee_user_id IS NULL)`) allowed any authenticated user to hijack any pending pairing without knowing `invite_code`.
  2. Simultaneously, `pairings_member_read` (`inviter_user_id = auth.uid() OR invitee_user_id = auth.uid()`) prevented a prospective invitee from reading or updating a pending pairing row by `invite_code`, deadlocking client-side acceptance.
  3. `consent_self_insert` allowed clients to forge arbitrary `consent_events`, while also preventing the invitee from logging the inviter's `pairing_accepted` event.
- **Fix (Builder Call)**:
  1. Drop policies `pairings_accept_invite`, `pairings_insert_as_inviter`, `pairings_member_update_status`, and `consent_self_insert`. All writes to `pairings` and `consent_events` go through hardened `SECURITY DEFINER` RPCs (`SET search_path = ''`):
     - `public.create_pairing_invite() RETURNS TABLE (pairing_id uuid, invite_code text, expires_at timestamptz)`:
       Checks caller has no `active` pairing; cancels any prior `pending` invite by caller; generates a cryptographically random 8-character alphanumeric uppercase code (`A-HJ-NP-Z2-9`, avoiding `0/O/1/I`); sets `invite_expires_at = now() + interval '48 hours'`; inserts and returns the pending pairing.
     - `public.preview_pairing_invite(p_invite_code text) RETURNS TABLE (pairing_id uuid, inviter_display_name text, expires_at timestamptz)`:
       Looks up non-expired pending pairing by normalized code without exposing `pairings` to table enumeration.
     - `public.accept_pairing_invite(p_invite_code text) RETURNS uuid`:
       Validates code is pending and `invite_expires_at > now()`; verifies caller is not `inviter_user_id` and neither user has an `active` pairing; updates `invitee_user_id = auth.uid()`, `status = 'active'`, `invite_code = NULL` (single-use consumption); **graduates solo desires** (`INSERT INTO public.desires (user_id, pairing_id, library_item_id, rating, note) SELECT d.user_id, v_pairing_id, d.library_item_id, d.rating, d.note FROM public.desires d WHERE d.user_id IN (v_inviter, v_invitee) AND d.pairing_id IS NULL ON CONFLICT (user_id, pairing_id, library_item_id) WHERE pairing_id IS NOT NULL DO NOTHING`); and writes `pairing_accepted` to `public.consent_events` for both `v_inviter` and `v_invitee`.
     - `public.update_pairing_status(p_pairing_id uuid, p_new_status public.pairing_status) RETURNS void`:
       Allows either member of an `active` or `paused` pairing to transition `active <-> paused` or `active|paused -> ended` (setting `ended_at = now()` and logging `pairing_ended` consent events for both members when ended).

---

## 5. Client & Edge Function Architecture (Completing v1 Functionalities)

### 5.1 Application-Level Encryption (`lib/crypto.ts`)
- **Purpose**: Encrypt `desires.note` and `journal_entries.body` before sending to Supabase so database administrators and raw SQL dumps only ever see ciphertext.
- **Mechanism (Builder Call)**:
  - Uses Web Crypto API (`globalThis.crypto.subtle`) where available (Web + modern Hermes) with an isomorphic authenticated encryption fallback (`AES-256-GCM` / `HMAC-SHA256` + `CTR` via `expo-crypto` / pure TS implementation so it runs identically in Jest, iOS, Android, and Web without native module build failures).
  - Key derivation: Derives a per-user 256-bit key deterministically from a local device secret stored in `AsyncStorage` (or `expo-secure-store` when available) bound to `user.id`, prefixed with version tag `enc:v1:<iv_hex>:<ciphertext_hex>:<tag_hex>`.
  - Any string starting with `enc:v1:` is decrypted transparently on read; legacy/unencrypted strings in test fixtures are handled gracefully by `decryptText`.

### 5.2 Complete Route & Component Structure
```text
app/
  _layout.tsx                     # Root auth + onboarding gate + BiometricLockGate
  index.tsx                       # Redirects to /(app)/home
  (auth)/
    _layout.tsx                   # Auth stack
    sign-in.tsx                   # Magic link + Passkey sign-in option
  (app)/
    _layout.tsx                   # Bottom Tab Navigator (Home, Library, Journal, Settings) + hidden modal/flow screens
    home.tsx                      # Today dashboard: Pairing card, Reveal status/CTA, Library progress, Journal card
    onboarding/
      tone.tsx                    # Step 1: Romantic / Playful / Direct
      tier.tsx                    # Step 2: Sensory / Suggestive / Explicit
      mode.tsx                    # Step 3: Explore Solo vs Invite Partner Now -> sets onboarding_complete = true
    library/
      index.tsx                   # Tier-filtered Desire Library list with inline expandable cards
      [id].tsx                    # Full-screen desire item detail, rating, encrypted note
    pairing/
      invite.tsx                  # Generate & share 8-char invite code / deep link (yesyasapp://pair?code=XXXX)
      accept.tsx                  # Deep link & manual code entry screen to preview and accept partner invite
    reveal/
      index.tsx                   # Reveal state machine: no_reveal | pending | computed | expired
    journal/
      index.tsx                   # Encrypted Solo Journal + AI Coach chat + Past entries + "Invite Partner" footer
      [id].tsx                    # Read-only decrypted journal entry view
    settings/
      index.tsx                   # Profile, Tone/Tier selectors, Biometric/PIN toggle, Pairing controls, Links
      consent.tsx                 # Tamper-evident Consent Audit Trail viewer with hash-chain verification badge
      export.tsx                  # Dual-consent Therapist Summary Export flow
components/
  StarRating.tsx                  # Accessible 1-5 star selector (44x44pt targets)
  LibraryItemCard.tsx             # Collapsed/expanded desire item card with debounced encrypted note
  PairingManageModal.tsx          # Pause / Resume / End pairing confirmation modal
  MismatchBridgeModal.tsx         # Curiosity Bridge modal with therapist-vetted conversation scripts
  BiometricGate.tsx               # Device biometric / 6-digit PIN lock overlay on app foreground
lib/
  theme.ts                        # Design tokens (light/dark palette, typography, spacing)
  crypto.ts                       # Client-side authenticated encryption (encryptText / decryptText)
  pairing.ts                      # Typed wrappers for create_pairing_invite, preview_pairing_invite, accept_pairing_invite, update_pairing_status
  desires.ts                      # Typed helpers for fetching library items, upserting ratings & encrypted notes
  reveal.ts                       # Typed helpers for trigger_reveal, withdraw_reveal, fetching reveal state & mismatch scripts
  journal.ts                      # Typed helpers for encrypted journal CRUD, AI coach invocation, and AI response flagging
  consent.ts                      # Typed helpers for fetching consent_events and verifying SHA-256 hash chain client-side
supabase/
  migrations/
    20260420000004_remediation_and_v1_completion.sql  # Corrective migration fixing Claims 1-4 + new tables/RPCs
  functions/
    ai-coach/
      index.ts                    # Deno Edge Function: JWT auth, 20/session & 100/day rate limit, safety prompt, ai_logs
      system-prompt.ts            # Version-controlled safety-reviewed system prompt
    therapist-export/
      index.ts                    # Deno Edge Function: verifies dual consent, builds summary report from reveals.summary
```

### 5.3 Legacy Firebase Lockdown
To address the reviewer's warning that the public repo previously exposed the Firebase config for `gen-lang-client-0707391511`, we include `scripts/lockdown-legacy-firebase.firestore.rules` containing a strict deny-all ruleset (`allow read, write: if false;`) and instructions in `docs/SUPABASE_SETUP.md` so the user can permanently shutter the abandoned Firestore instance in one command if desired.

---

## 6. Summary of Builder Calls Made
1. **Curiosity Bridge (`>= 4` and `= 3`) instead of Raw Mismatch (`>= 4` and `<= 2`)**: Prevents the 2-party elimination leak where a user learns which specific item their partner rejected (`<= 2`).
2. **In-DB Hardened `SECURITY DEFINER` RPCs for Pairing, Reveal, and Therapist Export Consent**: Keeps all multi-user state transitions atomic, transactional, and directly testable in `pgTAP` (`supabase/tests/rls_test.sql`), while Edge Functions handle external I/O (`ai-coach` LLM proxy and `therapist-export` document generation).
3. **Automatic Solo-to-Paired Desire Graduation inside `accept_pairing_invite`**: When two users pair, their existing solo ratings (`pairing_id IS NULL`) are automatically copied into the new `pairing_id` context so their prior reflection immediately powers their first mutual reveal without re-rating.
4. **Corrective Migration (`20260420000004_remediation_and_v1_completion.sql`)**: Preserves the chronological integrity of migrations `0001..0003` while cleanly upgrading the schema, policies, indexes, and functions.

# Backend Schema Document — YesYas!

**Version:** 1.0  
**Date:** June 2026  
**Status:** Active

---

## Authentication Flow

### Primary: Email Magic Link (OTP)

1. User enters email on sign-in screen
2. Client calls `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo } })`
3. Supabase sends a magic link email
4. User opens the link on their device
5. Supabase exchanges the token → creates a session
6. Client detects session via `onAuthStateChange`, redirects to app
7. On first sign-in: `on_auth_user_created` trigger fires → inserts a `profiles` row for the new user

### Secondary: Passkeys (FIDO2/WebAuthn)

- Available on iOS 17+, Android 14+, modern browsers
- Registered via `supabase.auth.enrollFactor` after initial sign-in
- Subsequent sign-ins use `supabase.auth.signInWithPasskey` (verify with platform biometric)

### Device Layer: Biometric Unlock

- Not a substitute for auth — supplements it
- On app foreground, if session is valid, `expo-local-authentication` prompts Face ID / fingerprint
- If biometric fails → PIN fallback (6-digit, stored via `expo-secure-store`, never sent to server)

### Session Management

```
flowType: 'pkce'
autoRefreshToken: true
persistSession: true
detectSessionInUrl: true (web only)
storage: AsyncStorage (native) | localStorage (browser) | memoryStorage (SSR)
```

Session token lifetime: Supabase default (1 hour access token, 1 week refresh token). Refresh happens automatically in background.

---

## Database Tables

### 1. `profiles`

Extends `auth.users` (1:1). Created automatically on first sign-in via trigger.

```sql
CREATE TABLE public.profiles (
  id                        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name              text,
  tone_preference           tone_label  NOT NULL DEFAULT 'romantic',
  content_tier_preference   desire_tier NOT NULL DEFAULT 'suggestive',
  locale                    text        NOT NULL DEFAULT 'en-US',
  onboarding_complete       boolean     NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now()
);
```

**Relationships:** 1:1 with `auth.users`, 1:many with `desires`, `journal_entries`, `consent_events`

**RLS:**
- Users can read and update only their own row (`id = auth.uid()`)
- No other users can read any profile row

---

### 2. `pairings`

Exclusive one-to-one relationship between two users. At most one `active` pairing per user.

```sql
CREATE TABLE public.pairings (
  id                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_user_id   uuid           NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invitee_user_id   uuid           REFERENCES public.profiles(id) ON DELETE CASCADE,
  status            pairing_status NOT NULL DEFAULT 'pending',
  invite_code       text           UNIQUE,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  CONSTRAINT inviter_invitee_differ
    CHECK (invitee_user_id IS NULL OR invitee_user_id <> inviter_user_id)
);

-- Enforce one active pairing per user (partial unique indexes)
CREATE UNIQUE INDEX pairings_one_active_inviter
  ON public.pairings (inviter_user_id) WHERE status = 'active';
CREATE UNIQUE INDEX pairings_one_active_invitee
  ON public.pairings (invitee_user_id) WHERE status = 'active';

-- Query indexes
CREATE INDEX pairings_inviter_status ON public.pairings (inviter_user_id, status);
CREATE INDEX pairings_invitee_status ON public.pairings (invitee_user_id, status);
```

**Status transitions:**
```
pending → active (invitee accepts invite code)
active → paused (either user pauses)
paused → active (either user resumes)
active|paused → ended (either user ends)
```

**RLS:**
- A user can read pairings where they are `inviter_user_id` OR `invitee_user_id`
- A user can INSERT a pairing only as inviter
- A user can UPDATE status only if they are a member of that pairing
- `ended_at` is set automatically on transition to `ended`

---

### 3. `desire_library_items`

Curated, read-only content. No user writes in v1.

```sql
CREATE TABLE public.desire_library_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text        UNIQUE NOT NULL,
  title       text        NOT NULL,
  description text,
  tier        desire_tier NOT NULL,
  tone_tags   text[]      NOT NULL DEFAULT '{}',
  locale      text        NOT NULL DEFAULT 'en-US',
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX desire_library_active_tier
  ON public.desire_library_items (active, tier);
```

**RLS:** Any authenticated user can SELECT where `active = true`. No INSERT, UPDATE, DELETE for non-service-role.

---

### 4. `desires`

A user's private ratings. **The most sensitive table. Never readable by any other user, ever.**

```sql
CREATE TABLE public.desires (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pairing_id       uuid        REFERENCES public.pairings(id) ON DELETE CASCADE,
  library_item_id  uuid        NOT NULL REFERENCES public.desire_library_items(id) ON DELETE RESTRICT,
  rating           smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  note             text,       -- Application-level encrypted before insert
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One rating per (user, pairing, item) — two partial unique indexes because UNIQUE treats NULLs as distinct
CREATE UNIQUE INDEX desires_unique_paired
  ON public.desires (user_id, pairing_id, library_item_id)
  WHERE pairing_id IS NOT NULL;

CREATE UNIQUE INDEX desires_unique_solo
  ON public.desires (user_id, library_item_id)
  WHERE pairing_id IS NULL;

CREATE INDEX desires_pairing_user
  ON public.desires (pairing_id, user_id)
  WHERE pairing_id IS NOT NULL;
```

**RLS:**
- SELECT, INSERT, UPDATE: only where `user_id = auth.uid()`
- DELETE: only where `user_id = auth.uid()`
- The reveal Edge Function runs as `SECURITY DEFINER` and bypasses RLS — this is the **only** controlled exception; it reads both users' ratings but writes only the intersection to `reveals`, never returning raw desires to the client

**Note column encryption:** The `note` field is encrypted in the application layer before being written to the database. The server stores ciphertext; only the authenticated client holds the key material (derived from the user's session).

---

### 5. `reveals`

Computed intersection of both users' high-rated items. Ephemeral.

```sql
CREATE TABLE public.reveals (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  pairing_id      uuid          NOT NULL REFERENCES public.pairings(id) ON DELETE CASCADE,
  status          reveal_status NOT NULL DEFAULT 'pending',
  triggered_by    uuid          NOT NULL REFERENCES public.profiles(id),
  triggered_at    timestamptz   NOT NULL DEFAULT now(),
  both_ready_at   timestamptz,
  revealed_at     timestamptz,
  expires_at      timestamptz,
  matches         jsonb,         -- Array of {library_item_id, title} — populated by Edge Function
  mismatches      jsonb,         -- Array of {library_item_id, title, direction} — populated by Edge Function
  summary         jsonb          -- {match_count} only — persists after expiry; matches/mismatches nulled
);

CREATE INDEX reveals_pairing_status ON public.reveals (pairing_id, status);
```

**Expiry:** A pg_cron job (or Edge Function scheduled task) runs every hour, finds reveals where `expires_at < now()` and `status = 'computed'`, nulls out `matches` and `mismatches`, sets `status = 'expired'`. The `summary` column (`{match_count}`) is never nulled.

**RLS:**
- SELECT: only users who are members of `pairing_id`
- INSERT: only via Edge Function (service role)
- UPDATE: only via Edge Function (service role)

---

### 6. `journal_entries`

Solo-mode private journal. Never linked to a pairing or partner.

```sql
CREATE TABLE public.journal_entries (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body                 text        NOT NULL,  -- Application-level encrypted
  ai_coach_thread_id   uuid,                  -- FK to future ai_threads table; nullable
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX journal_user_created ON public.journal_entries (user_id, created_at DESC);
```

**RLS:** SELECT, INSERT, UPDATE, DELETE only where `user_id = auth.uid()`. Zero cross-user access.

---

### 7. `consent_events`

Append-only, hash-chained audit log. Tamper-evident.

```sql
CREATE TABLE public.consent_events (
  id            uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid                NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pairing_id    uuid                REFERENCES public.pairings(id) ON DELETE SET NULL,
  event_type    consent_event_type  NOT NULL,
  payload       jsonb,
  payload_hash  text                NOT NULL,  -- SHA-256 of (id|event_type|payload|prev_hash)
  prev_hash     text,                          -- payload_hash of prior event for this user
  created_at    timestamptz         NOT NULL DEFAULT now()
);

CREATE INDEX consent_events_user_chain ON public.consent_events (user_id, created_at, id);
```

**Event types:** `pairing_accepted`, `pairing_ended`, `reveal_triggered`, `reveal_revealed`, `therapist_export`

**Immutability enforcement (defense in depth):**
- Triggers block UPDATE and DELETE at the SQL layer
- RLS blocks UPDATE and DELETE at the policy layer
- Application layer never issues UPDATE or DELETE on this table

**RLS:** SELECT only where `user_id = auth.uid()`. INSERT via application (service role not required). No UPDATE, DELETE permitted by any role except Supabase superuser (emergency only, logged).

---

## Enums

```sql
CREATE TYPE tone_label         AS ENUM ('romantic', 'playful', 'direct');
CREATE TYPE desire_tier        AS ENUM ('sensory', 'suggestive', 'explicit');
CREATE TYPE pairing_status     AS ENUM ('pending', 'active', 'paused', 'ended');
CREATE TYPE reveal_status      AS ENUM ('pending', 'both_ready', 'computed', 'expired');
CREATE TYPE consent_event_type AS ENUM (
  'pairing_accepted', 'pairing_ended',
  'reveal_triggered', 'reveal_revealed', 'therapist_export'
);
```

---

## Key Functions & Triggers

### `handle_new_user()` — auto-create profile on sign-up
```sql
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### `is_pairing_member(pairing_id, user_id)` — used by RLS policies
```sql
-- Returns boolean; used inside RLS USING clauses to avoid policy repetition
```

### `touch_updated_at()` — keep desires.updated_at fresh
```sql
CREATE TRIGGER desires_touch_updated_at
  BEFORE UPDATE ON public.desires
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
```

### `consent_events_chain()` — hash-chain insert trigger
```sql
-- On INSERT: locks per user (advisory lock), fetches prev_hash, computes SHA-256
CREATE TRIGGER consent_events_chain_trigger
  BEFORE INSERT ON public.consent_events
  FOR EACH ROW EXECUTE FUNCTION public.consent_events_chain();
```

### `consent_events_immutable()` — blocks UPDATE/DELETE
```sql
CREATE TRIGGER consent_events_no_update
  BEFORE UPDATE ON public.consent_events
  FOR EACH ROW EXECUTE FUNCTION public.consent_events_immutable();

CREATE TRIGGER consent_events_no_delete
  BEFORE DELETE ON public.consent_events
  FOR EACH ROW EXECUTE FUNCTION public.consent_events_immutable();
```

---

## Edge Functions

### `reveal-compute`
- **Trigger:** Called when second user taps "I'm ready" (sets `reveals.status = 'both_ready'`)
- **Security:** Runs as `SECURITY DEFINER`; the only context where both users' desires are read
- **Logic:** `SELECT * FROM desires WHERE pairing_id = ? AND user_id IN (?, ?)` → compute intersection (both `rating >= 4`) → compute mismatches (one `>= 4`, other `<= 2`) → write to `reveals.matches` and `reveals.mismatches` → set `status = 'computed'`, `revealed_at = now()`, `expires_at = now() + interval '24 hours'`
- **Output:** Updates the `reveals` row; never returns raw desire data to client

### `ai-coach`
- **Trigger:** Client POST with `{ message, thread_id? }`
- **Security:** Validates JWT; rate-limits (20 msg/session, 100/day); logs call with hashed user ID
- **Logic:** Prepends version-controlled system prompt → calls AI API → streams response → writes user message + AI response to journal thread
- **Safety:** System prompt refuses specific partner advice, explicit content, speculation about named third parties

### `therapist-export`
- **Trigger:** Both users have consented (two consent events written)
- **Logic:** Queries `reveals.summary` (not raw matches) + `profiles.display_name` for both users → generates structured PDF → uploads to Supabase Storage with 30-day signed URL → writes `therapist_export` consent event for both users
- **Output:** Returns signed URL; never emails directly

---

## Security Constraints

### Rate Limits (Edge Function layer)

| Endpoint | Limit |
|----------|-------|
| `auth.signInWithOtp` | Supabase built-in (do not override) |
| `reveal-compute` | 3 per pairing per day |
| `ai-coach` | 20 messages/session, 100/day per user |
| `therapist-export` | 5 per pairing per 30 days |
| All other writes | 10 requests/min per user |

### RLS Summary (non-negotiable invariants)

| Table | Read | Write |
|-------|------|-------|
| `profiles` | Own row only | Own row only |
| `pairings` | Member of pairing | Inviter creates; either member updates status |
| `desire_library_items` | All authenticated | Service role only |
| `desires` | Own rows only | Own rows only |
| `reveals` | Pairing members only | Edge Function (service role) only |
| `journal_entries` | Own rows only | Own rows only |
| `consent_events` | Own rows only | INSERT only; no UPDATE/DELETE |

### The Non-Negotiable Invariant

> **User A must never be able to read User B's desires.**

This is enforced at three independent layers:
1. RLS policy on the `desires` table
2. The `reveal-compute` Edge Function writes only intersection data to `reveals` — it never returns raw desire rows to the client
3. `supabase/tests/rls_test.sql` (pgTAP) asserts this on every migration. This test must stay green on every commit. If it fails, halt the release.

# Appflow Document — YesYas!

**Version:** 1.0  
**Date:** June 2026  
**Status:** Active

---

## Navigation Architecture

YesYas! uses Expo Router's file-based routing with two route groups gating auth state:

```
app/
  _layout.tsx          ← Root: boots Supabase session listener, enforces auth gate
  index.tsx            ← Redirect: signed-in → /(app)/home, signed-out → /(auth)/sign-in

  (auth)/
    _layout.tsx        ← Stack, no header
    sign-in.tsx        ← Magic link / passkey entry

  (app)/
    _layout.tsx        ← Tab navigator (Home, Library, Journal, Settings)
    home.tsx           ← Today surface
    library/
      index.tsx        ← Desire Library list
      [id].tsx         ← Single item detail + rating
    reveal/
      index.tsx        ← Trigger / waiting / result state machine
    journal/
      index.tsx        ← Journal home (past entries + AI chat)
      [id].tsx         ← Individual past entry
    pairing/
      invite.tsx       ← Generate/share invite code
      accept.tsx       ← Accept incoming invite (deep link target)
    settings/
      index.tsx        ← Settings home
      export.tsx       ← Therapist export flow
      consent.tsx      ← Consent history log
      account.tsx      ← Profile, tone/tier preferences, sign out
```

---

## Full Navigation Tree

### App Launch

```
Cold open
  │
  ├─ Supabase session check (loading spinner)
  │
  ├─ No session → /(auth)/sign-in
  │
  └─ Session exists
       ├─ First launch (no profile onboarding complete)?
       │    └─ /(app)/onboarding/tone
       │         └─ /(app)/onboarding/tier
       │              └─ /(app)/onboarding/mode
       │                   ├─ Solo → /(app)/journal
       │                   └─ Pair → /(app)/pairing/invite
       │
       └─ Returning user → /(app)/home
```

### (auth) Group

```
/(auth)/sign-in
  ├─ [Enter email] → [Send link]
  │    └─ "Check your email" state (same screen)
  │         └─ [Use a different email] → reset to input state
  │
  └─ Magic link opens in app (deep link: yesyasapp://auth/callback)
       └─ Supabase session established
            └─ Root _layout redirects to /(app)/home
```

### (app) Group — Tab Bar

Bottom tab bar appears on all (app) screens except modals and full-screen flows.

Tabs: **Home** | **Library** | **Journal** | **Settings**

---

### Home Tab — `/(app)/home`

```
Home
  ├─ Pairing card (if paired)
  │    ├─ [Start new reveal] → /(app)/reveal
  │    └─ [View pairing details] → modal: pairing info, pause/end options
  │
  ├─ "Invite a partner" card (if not paired)
  │    └─ [Invite partner] → /(app)/pairing/invite
  │
  ├─ Library card
  │    └─ [Rate now] → /(app)/library
  │
  └─ Journal card
       └─ [Write today] → /(app)/journal
```

**Pairing modal (from pairing card):**
```
Pairing Info Modal (bottom sheet)
  ├─ Partner name, status, date paired
  ├─ [Pause pairing] → confirmation modal → Supabase update → toast
  └─ [End pairing] → confirmation modal (destructive) → Supabase update → redirect to Home (unpaired state)
```

---

### Library Tab — `/(app)/library`

```
Library (index)
  ├─ Tier filter (Sensory / Suggestive / Explicit) → filters list in place
  │
  ├─ Item card (collapsed)
  │    └─ [Tap] → expands inline
  │         ├─ Full description visible
  │         ├─ Star rating (1–5) → tapping a star writes desire row to Supabase
  │         ├─ Optional note input → encrypted, saved on blur
  │         └─ 🔒 "Only you see your ratings" label always visible
  │
  └─ [Tap item title when expanded] → /(app)/library/[id] (full-screen detail)

Library item detail — /(app)/library/[id]
  ├─ Full description
  ├─ Star rating (same behavior as inline)
  ├─ Note input
  ├─ 🔒 Privacy label
  └─ [Back] → Library index
```

---

### Reveal Tab (modal-style flow) — `/(app)/reveal`

The reveal screen is a state machine. The current state is loaded from Supabase on mount.

```
Reveal (state: no active reveal)
  ├─ Summary: "You've rated N items"
  ├─ Privacy reassurance card
  └─ [I'm ready] → Supabase write (reveal row, status: pending)
                    └─ Realtime nudge sent to partner
                         └─ Reveal (state: waiting)

Reveal (state: waiting — current user ready, partner not)
  ├─ "Waiting for [partner]…" with countdown (72h window)
  ├─ Partner avatar + status indicator
  └─ [Withdraw my reveal] → confirmation modal
                             └─ Supabase delete reveal row
                                  └─ Reveal (state: no active reveal)

Reveal (state: both_ready — partner just tapped ready)
  ├─ "Both of you are ready!"
  ├─ [See our matches] → triggers Edge Function (reveal computation)
                          └─ Reveal (state: computed)

Reveal (state: computed — matches exist)
  ├─ "✨ You have N matches"
  ├─ Matched items list
  ├─ Mismatch bridge card (if applicable)
  │    └─ [Explore together] → modal: therapist-vetted script + "Park this" option
  ├─ Countdown: expires in Xh Xm
  └─ [Done] → Home

Reveal (state: expired)
  └─ "Your last reveal had N matches." (summary only, items gone)
       └─ [Start a new reveal] → Reveal (state: no active reveal)
```

**Mismatch bridge modal:**
```
Mismatch Bridge Modal
  ├─ Item title (anonymized which partner rated which way)
  ├─ Therapist-vetted conversation script (2–3 sentences)
  ├─ [Park this for now] → closes modal, logs consent event
  └─ [Talk about it] → closes modal (no further in-app action; script is the tool)
```

---

### Journal Tab — `/(app)/journal`

```
Journal (index)
  ├─ AI Coach chat (current session)
  │    ├─ Message thread (user + AI messages)
  │    ├─ [Text input] + [Send]
  │    │    └─ Message sent → Edge Function → AI response streamed in
  │    └─ [Report this response] (on AI message long-press) → flag modal
  │
  ├─ Past entries list (collapsed cards by date)
  │    └─ [Tap entry] → /(app)/journal/[id]
  │
  └─ [Invite partner] (sticky footer, solo-mode only)
       └─ Confirmation modal: "Your solo ratings will carry over"
            └─ [Confirm] → /(app)/pairing/invite

Journal entry detail — /(app)/journal/[id]
  ├─ Full entry text (read-only)
  ├─ Date, duration
  └─ [Back]
```

---

### Pairing Flows

```
/(app)/pairing/invite
  ├─ "Share this code with your partner"
  ├─ Invite code displayed (auto-copied on tap)
  ├─ [Share link] → native system share sheet
  └─ [Cancel] → Home

/(app)/pairing/accept  (deep link target: yesyasapp://pair?code=XXXX)
  ├─ "You've been invited to pair with [inviter name]"
  ├─ [Accept] → Supabase write (pairing status: active) → consent event logged → Home (paired state)
  └─ [Decline] → Home (unpaired state)
```

---

### Settings Tab — `/(app)/settings`

```
Settings (index)
  ├─ Profile section
  │    ├─ Display name (editable inline)
  │    ├─ Tone preference (Romantic / Playful / Direct) → select modal
  │    └─ Content tier (Sensory / Suggestive / Explicit) → select modal
  │
  ├─ Pairing section
  │    └─ [View pairing details] → same modal as Home pairing card
  │
  ├─ Privacy & Consent section
  │    └─ [Consent history] → /(app)/settings/consent
  │
  ├─ Therapist section
  │    └─ [Export summary] → /(app)/settings/export
  │
  └─ Account section
       ├─ [Sign out] → confirmation → supabase.auth.signOut() → /(auth)/sign-in
       └─ [Delete account] → multi-step confirmation (type "DELETE") → Supabase cascade delete → signed out

/(app)/settings/consent
  ├─ Chronological list of consent events (type, date, description)
  └─ [Back]

/(app)/settings/export
  ├─ "This requires both partners to consent"
  ├─ [Request export] → Supabase write → partner receives nudge
  │    └─ Partner opens nudge → /(app)/settings/export (partner view)
  │         └─ [I consent] → Supabase write → Edge Function generates PDF
  │              └─ Signed URL shown to both users (30-day TTL)
  │                   └─ [Share with therapist] → system share sheet
  └─ [Cancel] → Settings
```

---

## State Changes

### Auth States

| State | What the app does |
|-------|-------------------|
| Loading (initial) | Full-screen spinner; no navigation |
| Signed out | Hard redirect to `/(auth)/sign-in`; cannot access any `(app)` route |
| Signed in, no profile | Redirect to onboarding flow before Home |
| Signed in, profile complete | Normal app access |
| Session expired | Supabase auto-refresh attempts; if fails, redirect to sign-in with toast "Session expired" |

### Network / Offline States

| State | Behavior |
|-------|----------|
| Offline (no connection) | Toast: "You're offline. Some features need a connection." Read-only view of locally cached data where applicable |
| Slow connection | Loading indicators on all async operations; no timeout crashes |
| Supabase realtime disconnected | Polling fallback for reveal status (every 30s); indicator shows "Reconnecting…" |

### Data Loading States

Every screen that fetches data must implement three states:

1. **Loading** — skeleton cards or spinner, never blank screen
2. **Empty** — friendly empty-state copy (e.g., "No items rated yet — start with the Library")
3. **Error** — error card with retry button; error logged to Sentry

### Reveal-Specific States

| State | Trigger | UI |
|-------|---------|----|
| `pending` | One user taps "I'm ready" | Waiting screen with countdown |
| `both_ready` | Second user taps "I'm ready" | Both see "See our matches" prompt |
| `computed` | Edge Function writes matches | Reveal moment screen |
| `expired` | 24h after `computed` | Summary only (match count, no items) |

### Pairing States

| Status | Meaning | Available actions |
|--------|---------|------------------|
| `pending` | Invite sent, partner hasn't accepted | Cancel invite |
| `active` | Both users paired | Rate, reveal, export |
| `paused` | One user paused | Unpause, end |
| `ended` | Pairing terminated | View summary, start new pairing |

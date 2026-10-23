# Technical Requirements Document — YesYas!

**Version:** 1.0  
**Date:** June 2026  
**Status:** Active

---

## Tech Stack

### Frontend

| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | **Expo (React Native) ~54** | Single codebase for iOS, Android, and web via Expo Router |
| Navigation | **Expo Router ~6** (file-based) | Already configured; typed routes enabled |
| Language | **TypeScript ~5.9** | Strict mode; type safety on all DB interactions |
| State | **React built-ins** (useState, useEffect, Context) | Appropriate scope for v1; no Redux/Zustand overhead |
| Styling | **React Native StyleSheet** | No CSS-in-JS; native performance |
| Web rendering | **react-native-web ~0.21** | Shared component tree on web |
| Animation | **react-native-reanimated ~4** | Reveal animations, gesture-driven transitions |
| Auth UI | **expo-local-authentication ~17** | Biometric unlock layer |
| Icons | **@expo/vector-icons ~15** | Already installed |

### Backend

| Layer | Choice | Reason |
|-------|--------|--------|
| Database | **Supabase Postgres (managed)** | Relational model fits pairs + desires + audit logs; RLS is the auth enforcement layer |
| Auth | **Supabase Auth** | Email OTP (magic link) + passkeys + session management |
| Server logic | **Postgres RPCs + Supabase Edge Functions** | Reveal engine computation in hardened SQL, AI proxy & therapist export in Edge Functions — keeps secrets off the client |
| Realtime | **Supabase Realtime** | "Partner tapped ready" nudge without polling |
| Storage | **Supabase Storage** | Therapist export PDFs only; auto-purge after 30 days |
| Rate limiting | **Supabase built-in + pg_net guard** | All write endpoints rate-limited |

### AI

| Layer | Choice | Reason |
|-------|--------|--------|
| Model | **Anthropic Claude Sonnet** (preferred) or OpenAI GPT-4-class | Better safety posture for sensitive intimacy content; decide before Week 7 |
| Access pattern | **Server-side only** — called from Edge Functions, never from the client | Client never holds API keys |
| System prompt | Version-controlled in `supabase/functions/ai-coach/system-prompt.ts` | Safety-reviewed before every deploy |
| Logging | All AI calls logged with hashed user ID to `ai_logs` table | Weekly safety-rubric review |

---

## APIs & Third-Party Integrations

### In v1

| Service | Purpose | Notes |
|---------|---------|-------|
| **Supabase** | Database, Auth, Storage, Edge Functions, Realtime | Primary backend; single vendor |
| **Anthropic / OpenAI** | AI journaling coach | Server-side proxy only; never exposed to client |
| **Expo EAS** | Build, OTA updates, push notifications | `eas.json` config controls build profiles |
| **Vercel** | Web app hosting | Already wired via `vercel.json`; static export from Expo |
| **Sentry** | Error monitoring (client + server) | Add in Week 1; configure before first beta invite |
| **PostHog** (self-hosted) | Product analytics | No third-party analytics on reveal content; self-host for privacy |

### Explicitly Excluded in v1

- Stripe / payment processing (freemium launch; billing added in v1.1)
- Firebase (replaced by Supabase)
- Google Analytics, Mixpanel (privacy conflict)
- SendGrid / email provider (Supabase Auth handles transactional email)
- Twilio / SMS (no SMS auth in v1)

---

## Hosting & Deployment

### Mobile (iOS + Android)

- **Build tool:** Expo EAS Build
- **Distribution:** Apple App Store + Google Play
- **OTA updates:** Expo Updates (for JS-layer hotfixes without App Store review)
- **Environment management:** EAS Secrets for `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`; never in source code

### Web

- **Platform:** Vercel (already configured in `.vercel/project.json`)
- **Build:** `expo export -p web` → static output → Vercel CDN
- **Domain:** TBD; configure before beta
- **Headers:** CSP, HSTS, X-Frame-Options set at edge; no third-party scripts on reveal pages

### Backend (Supabase)

- **Primary region:** `us-east-1`
- **Staging project:** separate Supabase project (not a branch) — full isolation
- **Production project:** separate from staging; no manual SQL runs in prod, migrations only
- **EU region:** added in v1.1 for GDPR data-residency

### CI/CD

```
GitHub Actions pipeline:
  1. npm ci
  2. tsc --noEmit (typecheck)
  3. expo lint
  4. npm audit --omit=dev --audit-level=moderate
  5. supabase db diff --schema public (migration dry-run)
  6. EAS build (on merge to main)
  7. Vercel deploy preview (on PR)
  8. Vercel prod deploy (on merge to main)
```

---

## Security Requirements

### Authentication

- **Primary:** Email OTP (magic link via Supabase Auth)
- **Passkeys:** FIDO2/WebAuthn — supported on iOS 17+, Android 14+, modern browsers
- **Biometric unlock:** `expo-local-authentication` as a device-level lock on top of a valid session (does not replace auth)
- **PIN fallback:** 6-digit PIN for users without biometric hardware
- **Session persistence:** AsyncStorage on native; localStorage via Supabase default on web; SSR memory shim to avoid `window is not defined`
- **Token refresh:** `autoRefreshToken: true`, `persistSession: true`, `flowType: 'pkce'`
- **No social login in v1**

### Data Encryption

| Data | Encryption |
|------|-----------|
| All data in transit | TLS 1.3; HSTS preload |
| Database at rest | AES-256 via Supabase managed KMS |
| `desires.note` column | Application-level encryption before write (column-level) |
| `journal_entries.body` column | Application-level encryption before write |
| Therapist export PDFs | Encrypted in Supabase Storage; signed URL, 30-day TTL |

### Row-Level Security (RLS)

RLS policies are the authorization layer — no server-side code bypasses them. Core invariants:

- A user can only read their own `desires` rows — never a partner's
- A user can only read `reveals` rows belonging to their active pairing
- `consent_events` is append-only at the SQL layer (UPDATE/DELETE blocked by trigger)
- `desire_library_items` is read-only for all authenticated users
- `journal_entries` are readable only by their owner

### Rate Limiting

- All Edge Function write endpoints: max 10 requests/minute per user
- OTP email: Supabase built-in rate limiting (do not disable)
- AI journaling: max 20 messages/session, 100 messages/day per user

### Supply Chain

- `npm audit --omit=dev --audit-level=moderate` runs in CI on every push
- Exact version pins for Expo SDK and React Native in `package.json`
- `package-lock.json` committed and verified
- Dependabot configured for security patches
- Supabase Edge Functions use `deno.lock`

---

## Environment Variables

```bash
# Client-side (EXPO_PUBLIC_ prefix = safe to bundle)
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=

# Server-side (Edge Functions only — never in client bundle)
ANTHROPIC_API_KEY=        # or OPENAI_API_KEY
SUPABASE_SERVICE_ROLE_KEY=
```

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| App cold start (JS bundle parse) | < 2s on a 3-year-old mid-range device |
| Reveal computation (SQL RPC) | < 1s for up to 200 rated items |
| Supabase RLS query overhead | < 50ms added per query |
| Availability | 99.5% (Supabase SLA is 99.9%; Vercel CDN is 99.99%) |
| WCAG compliance | 2.1 AA from day one |
| Screen recording protection | `FLAG_SECURE` on Android reveal screens; blur-on-app-switch on iOS |

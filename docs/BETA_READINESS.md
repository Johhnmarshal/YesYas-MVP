# Beta readiness runbook

**Last verified:** 2026-10-25 against `main` and the live project
`flauqfikspnywcvtevnq` (eu-west-1). Every claim in section 0 was checked by
running a query or a call against the hosted project, not by reading code.
Sections 2 onwards need a credential or an approval that automation does not
have.

The previous revision of this file is largely obsolete: it said the live
project served 15 library items, had zero Edge Functions deployed, had never
had its Site URL changed from `http://localhost:3000`, and had two outstanding
migrations. None of that is true any more. What follows replaces it.

---

## 0. What is true now, by measurement

| Check | Result |
|---|---|
| Migrations applied | 14, matching the repo's 14 files |
| RLS | enabled on every table in `public`; 0 tables without it |
| `anon` EXECUTE on `SECURITY DEFINER` functions | **0** (was 13) |
| `authenticated` EXECUTE | 10 functions |
| Desire library | **180 active items** — 60 sensory, 60 suggestive, 60 explicit |
| Edge Functions | `ai-coach` and `therapist-export` both **ACTIVE** |
| Reveal expiry cron | `expire-reveals` scheduled `*/15 * * * *` |
| Magic-link sign-in | **works** — a real session was established at 2026-10-25 00:29:55Z |

### The whole couple journey runs on production

Executed inside `begin; … rollback;` against the live database:
invite → accept → rate → both-ready → reveal.

```
invite_created    t          second_trigger  computed
pairing_accepted  t          matches         1
first_trigger     pending    bridges         1
consent_rows      6          profiles_created 2
```

The rating-1 hard veto was correctly excluded from both lists. The reveal
payload carries only `library_item_id, slug, title, description, tier` — no
`rating`, no `note`, no `user_id` — so it cannot say who wanted what.

Ending a pairing and pairing again also works: status goes to `ended` with
`ended_at` stamped, both partners get a `pairing_ended` consent row, the
ratings survive, and a fresh invite is accepted normally.

### The database is still empty of real use

1 user, 1 profile, **0 pairings, 0 desires, 0 reveals, 0 journal entries,
0 consent events, 0 `ai_logs` rows.** Nothing past sign-in has ever run with
real data. Everything in section 0 above was proved with throwaway users in
rolled-back transactions, which is the next best thing but not the same thing.

---

## 1. The one thing actually blocking a beta: email

The project is on Supabase's built-in SMTP, which allows **2 emails per hour,
project-wide**. Auth logs for 2026-10-24 show 11 of 13 OTP requests in a single
hour rejected with `429: email rate limit exceeded`.

Magic-link login works. It just cannot be done by more than two people an hour,
and a tester who mistypes their address burns one of the two.

This is yours to fix — it needs an SMTP credential:

1. Create a sender on Resend, Postmark, SendGrid or SES.
2. `supabase/config.toml` already carries the `[remotes.production.auth.email.smtp]`
   block, commented out. Fill in host, port, user and sender, then:

```bash
supabase secrets set SUPABASE_AUTH_SMTP_PASS=... --project-ref flauqfikspnywcvtevnq
supabase config push --project-ref flauqfikspnywcvtevnq
```

Run `config push` without `--yes` the first time and read the diff: it sends
the whole `[remotes.production.auth]` block, not just the SMTP keys, so check
it is not reverting something set deliberately in the dashboard.

Until that lands, invite testers in pairs, an hour apart.

---

## 2. Dashboard toggles that no file can express

- **Leaked-password protection** — Authentication → Policies. Not expressible
  in `config.toml`; it has to be the dashboard.
- **Minimum password length 12** — committed to `config.toml` but never
  pushed, because `config push` has not been run. It lands with the SMTP push
  above.

---

## 3. Redeploy `ai-coach`

The deployed copy is the version that pinned `claude-3-5-sonnet-20241022` and
swallowed every non-ok response. Today's fix is in `main` but **not deployed**:

```bash
supabase functions deploy ai-coach --project-ref flauqfikspnywcvtevnq
```

It also needs a provider key, or it serves canned reflective prompts for ever:

```bash
supabase secrets set ANTHROPIC_API_KEY=... --project-ref flauqfikspnywcvtevnq
supabase secrets list --project-ref flauqfikspnywcvtevnq   # confirm
```

With the fix in place a missing or revoked key is now visible in the function
logs instead of silent, so check them once after the first journal entry.

## 4. Apply `20261025000004`

The reveal guard — a reveal now needs 3 ratings in the pairing — is in `main`
and in CI, but not on the hosted project:

```bash
supabase db push --project-ref flauqfikspnywcvtevnq
```

**Note on migration bookkeeping.** Three migrations were applied to production
through the MCP tooling, which assigns its own version numbers, so the history
table records them as `20261025010005`, `20261025012033` and `20261025060251`
rather than the repo's `…000001`, `…000002`, `…000003`. `db push` will
therefore try to apply those three again. All three are idempotent — the
policies are `drop policy if exists` then create, the columns and indexes are
`if not exists`, the functions are `create or replace`, and
`cron.schedule('expire-reveals', …)` upserts by job name (verified: re-running
it leaves exactly one job). So the re-application is harmless. It is untidy,
not dangerous, and not worth rewriting production migration history to fix.

---

## 5. Lock down the legacy Firebase project (R-05)

The prototype PR is closed; the deny-all ruleset is written but not deployed.

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules --project gen-lang-client-0707391511
```

Run it from a directory whose `firebase.json` points `firestore.rules` at
`scripts/lockdown-legacy-firebase.firestore.rules`, or paste that file into
Firebase Console → Firestore Database → Rules.

Note that the retired `yesyas-firebase/` prototype also carried a live Firebase
web config. Web API keys are designed to be public and are protected by rules,
not secrecy — which is exactly why this ruleset matters.

---

## 6. Mobile builds

| | Status |
|---|---|
| Icons at valid dimensions | **Done** — 1024×1024 and 48×48, no alpha |
| EAS project id | **You** — `eas init` |
| Apple Developer account | **You** — $99/yr, needed for anything past a simulator build |

```bash
npm install -g eas-cli
eas login
eas init
eas build --profile preview --platform android   # internal APK, no Apple account needed
```

Set the backend variables per environment first or the build ships with no backend:

```bash
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://flauqfikspnywcvtevnq.supabase.co
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key from Dashboard → API>
```

The icons are flat brand-coloured squares with no mark. Fine for TestFlight and
Play internal testing; public store review will reject them.

---

## 7. Open, not blocking a beta

- **Sentry and PostHog** (R-11, R-18) — you will run the beta blind to errors
  and retention. The TRD called both week-1.
- **Push notifications** (R-10) — the reveal is a two-sided handshake with a
  72-hour window and no way to tell a partner their turn has come. Still the
  biggest risk to the >60% reveal-completion target.
- **Therapist export PDF** (R-19) — `window.print()` on web, plain text on
  native. No bucket, signed URL or 30-day purge.
- **AI coach sends no conversation history**, so it cannot follow a thought
  across turns.
- **Reveal cadence has no entitlement bypass** — `trigger_reveal` refuses
  unconditionally after one reveal per 7 days, so the PRD's "Premium:
  unlimited reveals" is not expressible.
- **Consent audit screen reads at most 1000 rows** — PostgREST's default
  ceiling. The chain still verifies because it is a prefix from genesis, but a
  heavy user would eventually stop seeing their recent events.
- **Nothing in CI exercises the Edge Functions' behaviour.** As of today CI
  type-checks them with Deno, which is new and catches the class of error that
  previously reached production unnoticed, but nothing invokes them.

---

## 8. Smoke test

`scripts/production-smoke-test.sql` runs the whole journey plus the 24-hour
expiry, new-user onboarding, GDPR erasure, consent-chain ordering and the
double-blind payload, each inside its own `begin; … rollback;`.

```bash
psql "$DATABASE_URL" -f scripts/production-smoke-test.sql
```

Afterwards confirm it left nothing behind:

```sql
select count(*) from auth.users where email like '%@yesyas.invalid';  -- expect 0
```

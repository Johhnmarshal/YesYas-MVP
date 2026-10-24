# Beta readiness runbook

**Last verified:** 2026-10-24 against `main` and the live project `flauqfikspnywcvtevnq` (eu-west-1, `ACTIVE_HEALTHY`).

Every step here needs a credential or an approval that automation does not have.
Ordered so each one unblocks the next.

---

## 0. What is already true

Verified by running, not by reading:

- The live project has the full schema: 11 tables, 14 RPCs, RLS on every table, 0 tables without policies.
- `https://yesyas.vercel.app` loads, routes to `/sign-in`, renders clean, no console errors.
- Its bundle targets `https://flauqfikspnywcvtevnq.supabase.co` — the real project, not the CI placeholder.
- CI on `chore/audit-test-and-hygiene` is green: pgTAP, typecheck, lint, domain logic, web export.

**The web app is a usable beta channel today.** Mobile is not — see step 6.

---

## 1. Merge the two open PRs

`main` is red and has been since `77a25b1`. These two fix it.

```bash
gh pr merge 5 --repo Johhnmarshal/YesYas-MVP --merge
gh pr merge 6 --repo Johhnmarshal/YesYas-MVP --merge   # retargets to main once #5 lands
```

`#5` carries the screen-capture key fix, the account-deletion foreign-key fix and the restored `reveal_revealed` audit rows. `#6` carries the DELETE assertion, the anon revoke, the function hardening and the icons.

Then bring the local checkout back in line:

```bash
cd /c/Users/oluwa/dev/YesYas-MVP && git checkout main && git pull --ff-only && git branch -d fix/screen-capture-keys-and-deletion-flag chore/audit-test-and-hygiene
```

---

## 2. Apply the outstanding migrations to the live project

Migrations `20260420000004` through `20261024000002` are already applied. Still outstanding:

- `20261024000003_revoke_anon_rpc_execute.sql`
- `20261024000004_harden_unauthenticated_functions.sql`

Until these land, **all 13 `SECURITY DEFINER` functions are callable with no session**, because Supabase's default privileges grant `EXECUTE` on new functions in `public` to `anon` and `revoke ... from public` does not touch that.

```bash
cd /c/Users/oluwa/dev/YesYas-MVP
supabase login
supabase link --project-ref flauqfikspnywcvtevnq
supabase db push
```

`supabase link` asks for the database password — Dashboard → Project Settings → Database → Database password. Reset it there if it is not recorded anywhere.

Confirm afterwards in the Dashboard → Advisors → Security. The `anon_security_definer_function_executable` warning should drop from 13 findings to 0. `rls_enabled_no_policy` on `ai_logs` is expected and intentional: it is written only by Edge Functions using the service-role key.

---

## 3. Seed the library on the live project

**The live project serves 15 library items. The repo has 180.**

This is the trap: `supabase/seed.sql` runs on `supabase db reset` (local) and in the CI `db-test` job. It does **not** run on `supabase db push`. Applying migrations never seeds content, so the library has been stuck at whatever it was first seeded with.

The file ends with `on conflict (slug) do nothing`, so it is safe to run against a project that already holds some of the rows.

Easiest route — Dashboard → SQL Editor → paste the contents of `supabase/seed.sql` → Run.

Or from the CLI, with the pooler connection string from Dashboard → Project Settings → Database → Connection string → URI:

```bash
psql "postgresql://postgres.flauqfikspnywcvtevnq:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" -f supabase/seed.sql
```

Verify:

```sql
select tier, count(*) from public.desire_library_items group by tier order by tier;
-- expect 60 explicit, 60 sensory, 60 suggestive
```

---

## 4. Auth redirect allowlist — do this before inviting anyone

**This is the most likely thing to break sign-in on day one, and it is a two-minute fix.**

`supabase/config.toml` declares `site_url = "http://localhost:8081"` and allowlists only `yesyasapp://`. That file configures the *local* stack. The remote project has its own setting, and the web app sends `emailRedirectTo: window.location.origin` — which in production is `https://yesyas.vercel.app`.

If that origin is not allowlisted on the remote project, every magic link either fails or bounces the tester to `localhost`.

This cannot be tested without sending a real email, so it has to be checked by eye:

Dashboard → Authentication → URL Configuration

- **Site URL:** `https://yesyas.vercel.app`
- **Redirect URLs** must include:
  - `https://yesyas.vercel.app`
  - `https://yesyas.vercel.app/**`
  - `yesyasapp://` (native deep link)
  - `yesyasapp://**`
  - `http://localhost:8081` (local development)

Then send yourself one magic link from the live site and confirm it lands back on `yesyas.vercel.app` signed in. That single test exercises auth, the redirect, the session and the profile trigger in one go.

---

## 5. Lock down the legacy Firebase project (R-05)

The prototype PR is closed. The deny-all ruleset is written but not deployed.

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules --project gen-lang-client-0707391511
```

Run it from a directory whose `firebase.json` points `firestore.rules` at `scripts/lockdown-legacy-firebase.firestore.rules`, or paste that file's contents into Firebase Console → Firestore Database → Rules.

---

## 6. Mobile builds

Three things were blocking. One is now fixed.

| | Status |
|---|---|
| Icons at valid dimensions | **Done** — 1024×1024 and 48×48, no alpha channel |
| EAS project id | **You** — `eas init` |
| Apple Developer account | **You** — $99/yr, needed for anything beyond a simulator build |

```bash
npm install -g eas-cli
eas login
eas init                      # writes extra.eas.projectId into app.json
eas build --profile preview --platform android   # internal APK, no Apple account needed
```

Set the two Supabase variables per environment first, or builds produce an app with no backend:

```bash
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://flauqfikspnywcvtevnq.supabase.co
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key from Dashboard → API>
```

**The icons are placeholders — flat brand-coloured squares with no mark.** They are fine for internal TestFlight and Play internal testing. Public store review will reject them as incomplete, so real artwork is needed before submission.

---

## 7. Still open, not blocking a beta

- **Sentry and PostHog** (R-11, R-18) — you will run the beta blind to errors and retention without them. The TRD called both week-1.
- **Push notifications** (R-10) — the reveal is a two-sided handshake with a 72-hour window and no way to tell a partner their turn has come. This is the single biggest risk to the >60% reveal-completion target.
- **Therapist export PDF** (R-19) — currently `window.print()` on web and plain text on native. No bucket, signed URL or 30-day purge exists.
- **AI coach** — sends no conversation history, so it cannot follow a thought across turns, and pins `claude-3-5-sonnet-20241022`, two generations old.
- **Reveal cadence has no entitlement bypass** — `trigger_reveal` raises unconditionally after one reveal per 7 days, so the PRD's "Premium: unlimited reveals" is impossible as written.
- **`expire_old_reveals` has no cron** — the 24-hour reveal expiry only runs when a client opens the app. Schedule it:

  ```sql
  select cron.schedule('expire-reveals', '*/15 * * * *', 'select public.expire_old_reveals()');
  ```

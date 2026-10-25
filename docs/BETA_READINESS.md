# Beta readiness runbook

**Last verified:** 2026-10-25 against `main` and the live project
`flauqfikspnywcvtevnq` (eu-west-1). Every claim in section 0 was checked by
running a query or a call against the hosted project, not by reading code.
Sections 2 onwards need a credential or an approval that automation does not
have: this session's tooling is refused `apply_migration`,
`deploy_edge_function` and `config push` against the live project, so every
fix to its schema, functions or auth config lands in `main` and waits for you.

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
| Auth config | `mailer_autoconfirm: true`, `disable_signup: false`, email the only provider |

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

## 1. Email: rate-limited, but not the blocker it looked like

Read from the live GoTrue config (`GET /auth/v1/settings`, a public endpoint):

```json
"disable_signup": false,
"mailer_autoconfirm": true,
"external": { "email": true, ... all providers false }
```

`mailer_autoconfirm: true` is the important one. **Email confirmation is off**,
so `signUp` returns a live session immediately and sends no email at all. A
tester can create an account and be signed in without any mail being
delivered.

So the built-in SMTP cap — **2 emails per hour, project-wide**, which rejected
11 of 13 OTP requests in a single hour on 2026-10-24 with
`429: email rate limit exceeded` — limits the **magic-link path only**. It does
not gate onboarding, and it does not gate a beta.

Magic-link login itself works: a real session was established at
2026-10-25 00:29:55Z. It just cannot be done by more than two people an hour,
and a mistyped address burns one of the two.

What the app does about it: on a 429 the sign-in screen switches to the
passphrase tab, holds a 15-minute cooldown (a short retry would fail too), and
now also reveals Create account — a tester told "sign in without waiting for
an email" often has no account yet, and previously had to fail a sign-in
first to discover the button.

### Still worth fixing, when you can

Custom SMTP removes the cap and lets you turn confirmations back on. The
`[remotes.production.auth.email.smtp]` block is scaffolded and commented out
in `supabase/config.toml`:

```bash
supabase secrets set SUPABASE_AUTH_SMTP_PASS=... --project-ref flauqfikspnywcvtevnq
supabase config push --project-ref flauqfikspnywcvtevnq
```

Run `config push` without `--yes` the first time and read the diff: it sends
the whole `[remotes.production.auth]` block, not just the SMTP keys.

### The security cost of the current setting

`disable_signup: false` with `mailer_autoconfirm: true` means **anyone can
register any email address they do not own, and it is confirmed on the spot.**
Two probe requests on 2026-10-25 demonstrated it by accident: both returned
`400 email_address_invalid` and still left confirmed users with profiles
behind. They were deleted.

For a small invited beta this is a tolerable trade for being able to onboard
at all. It is not acceptable at launch, because an attacker can squat a real
person's address before they sign up — in an app about their intimate life.
`sign-in.tsx` already refuses to create accounts as a side effect of a failed
sign-in, which removes the worst of it (account creation is a separate,
explicit action, and the errors are deliberately neutral so the screen is not
an enumeration oracle). The rest closes when confirmations go back on, which
needs the SMTP credential above.

---

## 2a. CONFIRMED LIVE: remove `*.vercel.app` from the redirect allowlist

**This is verified on the hosted project, not a theoretical risk, and it is the
one thing to fix before inviting anybody.**

**Dashboard → Authentication → URL Configuration → Redirect URLs.** Remove
`https://*.vercel.app` and `https://*.vercel.app/**`.

`supabase/config.toml` carried that entry until 2026-10-25 and it is an
account-takeover vector. Supabase honours wildcards in the host and
`vercel.app` is a shared public domain:

1. `signInWithOtp` is a client call and the anon key ships in the web bundle,
   so anyone can send a request with any `emailRedirectTo`.
2. Supabase validates it against Site URL plus the allowlist, and
   `https://anything-they-own.vercel.app` matched.
3. The victim gets a **genuine** YesYas sign-in email, from the real sender,
   and clicks it.
4. The code arrives at the attacker's origin and is exchanged for a session on
   an account holding that person's journal and private notes.

The email being real is what makes it worse than ordinary phishing — none of
the usual signals apply.

### How this was confirmed

GoTrue validates `redirect_to` against the allowlist and then redirects, so an
invalid token is a side-effect-free oracle — no email is sent, no account is
touched, and the `Location` header says which redirect was honoured:

```bash
curl -sS -o /dev/null -D -   "https://flauqfikspnywcvtevnq.supabase.co/auth/v1/verify?token=0000000000&type=magiclink&redirect_to=https%3A%2F%2Fanything-you-like.vercel.app"   -H "apikey: <the anon key from .env>" | grep -i '^location:'
```

Measured 2026-10-25:

| `redirect_to` | Result |
|---|---|
| `https://yesyas.vercel.app` | honoured — correct |
| `https://<random>.vercel.app` | **honoured — the hole** |
| `https://<random>.vercel.app` (second random name) | **honoured** |
| `https://<random>.netlify.app` | fell back to Site URL — correct |
| `https://<random>-deep.sub.vercel.app` | fell back — the wildcard is one label |
| `https://yesyas.vercel.app.evil.com` | fell back — no suffix confusion |
| `http://localhost:8081` | honoured — allowlisted for development |

The `netlify.app` and `evil.com` rows are the important controls: the allowlist
**is** being enforced, and it still accepted an arbitrary `vercel.app`
subdomain. Re-run the same probe after fixing it — the random `vercel.app` row
should fall back to `https://yesyas.vercel.app`.

It is already removed from `supabase/config.toml`, so a `config push` will not
reintroduce it, but the live value came from the dashboard and only the
dashboard will clear it.

The allowlist should contain exactly: `https://yesyas.vercel.app`,
`https://yesyas.vercel.app/**`, `yesyasapp://`, `yesyasapp://**`, and the
localhost entries for development. If a preview deployment ever needs to sign
in, add that exact URL, or at narrowest
`https://yesyas-*-<your-team-slug>.vercel.app`.

---

## 2. Dashboard toggles that no file can express

- **Leaked-password protection** — Authentication → Policies. Not expressible
  in `config.toml`; it has to be the dashboard.
- **Minimum password length 12** — committed to `config.toml` but never
  pushed, because `config push` has not been run. It lands with the SMTP push
  above.

---

## 3. Redeploy both Edge Functions

The deployed copy is the version that pinned `claude-3-5-sonnet-20241022` and
swallowed every non-ok response. Today's fix is in `main` but **not deployed** —
`deploy_edge_function` is refused by the permission classifier with
`[Production Deploy]`, as `apply_migration` and `config push` are, so this one
is yours:

```bash
supabase functions deploy ai-coach --project-ref flauqfikspnywcvtevnq
supabase functions deploy therapist-export --project-ref flauqfikspnywcvtevnq
```

`therapist-export` matters as much as the coach. It took `pairingId` from the
request body and gated on membership plus dual consent, neither of which lapses
when a pairing ends — the row keeps both user ids for ever, and consent granted
while the relationship was live stays valid for the rest of the 7-day window.
So for up to a week after a breakup either party could POST the old pairing id
and receive the clinical summary. The deployed copy still can.

It also needs a provider key, or it serves canned reflective prompts for ever:

```bash
supabase secrets set ANTHROPIC_API_KEY=... --project-ref flauqfikspnywcvtevnq
supabase secrets list --project-ref flauqfikspnywcvtevnq   # confirm
```

With the fix in place a missing or revoked key is now visible in the function
logs instead of silent, so check them once after the first journal entry.

## 4. Apply the two pending migrations

Both are in `main` with CI green, neither is on the hosted project. One
`db push` lands both:

```bash
supabase db push --project-ref flauqfikspnywcvtevnq
```

- **`20261025000004`** — the reveal guard. A reveal now needs 3 ratings in the
  pairing, so a couple cannot spend their weekly slot on an empty one. Until
  this lands, smoke-test check 7 reports
  `ALLOWED - 20261025000004 is not applied to this database`, which is the
  check working rather than failing.
- **`20261025000005`** — normalises `asking-for-what-I-want` to lowercase. This
  one has to land, because `supabase/seed.sql` now carries the lowercase slug
  and ends with `on conflict (slug) do nothing`. If the seed is ever re-run
  against a database that still holds the capitalised slug, it inserts a second
  near-identical item — 181 rows, two entries with the same title, both
  separately matchable in a reveal. Verified against production in a
  rolled-back transaction: afterwards, 0 malformed slugs and still exactly 180
  rows.

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
| `expo-dev-client` | **Done** — `eas.json`'s `development` profile sets `developmentClient: true`, which EAS validates against the package. It was missing, so both development profiles would have failed; now pinned to `~6.0.20` per the SDK's own manifest |
| EAS project id | **You** — `eas init` |
| Apple Developer account | **You** — $99/yr, needed for anything past a simulator build |

```bash
npm install -g eas-cli
eas login
eas init
eas build --profile preview --platform android   # internal APK, no Apple account needed
```

A `development` build is worth doing before any store submission. Four modules
this app depends on are native-only — `expo-secure-store` (the device
encryption key), `expo-local-authentication` (the lock screen),
`expo-screen-capture` (FLAG_SECURE, the only real screenshot protection the
product has) and `expo-haptics`. Three of them deliberately no-op on web, so
none of that behaviour is exercised by the web beta at all.

Set the backend variables per environment first or the build ships with no backend:

```bash
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://flauqfikspnywcvtevnq.supabase.co
eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key from Dashboard → API>
```

The icons are flat brand-coloured squares with no mark. Fine for TestFlight and
Play internal testing; public store review will reject them.

---

## 6b. Fixed on 2026-10-25 — in `main`, CI green

Each of these was found by reading a code path that had never executed against
real data, then proving the behaviour against the hosted project inside a
rolled-back transaction. Production still has 1 user, 0 pairings, 0 desires,
0 reveals and 0 journal entries, so none of them had ever been hit by anyone.

| Fix | What it did before |
|---|---|
| Content tier ceiling | Choosing a tier filter, then lowering your content tier in Settings, kept listing the tier you had just opted out of — 60 explicit items under a padlocked pill |
| Reveal guard | Both partners tapping "ready" before rating anything produced a `0 match / 0 bridge` reveal and then locked the feature for 7 days |
| AI coach | Never answered once. OpenAI was unreachable whenever an Anthropic key existed, non-ok responses were swallowed silently, `content[0].text` read the thinking block, and `max_tokens: 300` was shared with thinking |
| Coach disclosure | A canned stock reply was presented as a real one; safety redirects were then mislabelled as "coach not switched on" |
| Recovery code | Nothing warned you that a reinstall destroys every journal entry — the only mention was in Settings |
| PIN lock | The locked screen had no exit at all. Forgetting six digits meant reinstalling, which destroyed the journal |
| Invite share | Handed every web tester a `yesyasapp://` link their browser cannot open |
| Every dialog on web | `react-native-web`'s `Alert` is `static alert() {}` — a no-op. 13 error and success messages never appeared, and 2 confirmations ("Sign Out", "Delete entry") were dead buttons, because the work lived in a callback that could not fire |
| Tier ceiling, part 2 | The item detail screen fetched by id and never read the user's tier, so an above-ceiling item rendered in full with a working rating. Reachable by browsing explicit items, lowering the tier, and pressing Back |
| Onboarding | Reaching step 3 without parameters committed the parser defaults — a content tier the user was never shown — and marked onboarding complete |
| Passphrase copy | The button said "Sign in / Create beta account" and the hint promised account creation, months after that fall-through was deliberately removed |
| Every share button on web | `react-native-web`'s `Share` rejects without the Web Share API, and all four call sites swallowed it as "user cancelled". "Share invite" — the path a partner joins by — did nothing on Firefox desktop and in embedded Chromium. Now falls back to the clipboard |
| Privacy shield | The Privacy Model promised a blur "whenever you switch apps"; it existed only on the reveal screen, so journal contents sat unobscured in the iOS app switcher. Now on all three screens, and the screen no longer omits the web, where no such protection can exist |
| Home vs reveal disagreement | Home read only `status`, so it announced "Active reveal: N matches" for up to 15 minutes after the reveal screen called it expired, and "waiting for your partner" days after the 72-hour window shut |
| Private notes | The 800ms debounce was cleared on unmount without flushing, so typing was discarded when a library row scrolled out of the FlatList window, a filter stopped matching it, or the user left by any route other than the back button |
| Onboarding re-run | `fetchProfileOnboardingStatus` returned `false` on any error, so a dropped request routed a signed-in user back through onboarding — which overwrites tone and content tier on completion |
| Recovery code | Could only be transcribed by hand, 24 characters, on the one screen standing between a tester and silent permanent data loss. Now copyable (clipboard only, never the share sheet) |
| Magic-link redirect wildcard | `https://*.vercel.app` is an accepted redirect target, so any site on the shared Vercel domain can receive a real sign-in token for any address an attacker chooses to mail. Removed from the repo; **confirmed still live on the project — see section 2a** |
| Clinical export survived a breakup | `therapist-export` never checked pairing status, though its own comment claimed it did. Membership and dual consent both outlive an ended pairing, so for up to 7 days after a breakup either party could POST the old pairing id and get the summary |
| Private note became a shared signal | Writing a note on an unrated item stored `rating: 3` — exactly `trigger_reveal`'s Curiosity Bridge threshold — so if the partner rated it 4 or 5, the item surfaced in the couple's shared reveal as something one of them was "open to exploring". Verified end to end: a note-only item came back inside `reveals.mismatches` |
| Consent audit screen | **The worst one.** `consent_events_chain()` hashes `payload::text`, and jsonb sorts object keys by byte length then bytewise; `lib/consent.ts` sorted alphabetically. Both `reveal_triggered` payloads order differently under the two rules, so `verifyConsentChain` returned `valid: false` and the screen rendered "Audit Chain Integrity Failure" over an intact log — for every couple that had triggered a reveal |
| Library slug | One of 180 slugs had a capital letter. Harmless alone, but `seed.sql` ends `on conflict (slug) do nothing`, so lowercasing it in the seed alone would insert a second near-identical item on the next reseed |
| Locked-content copy | Four messages sent users to Settings to "unlock with your recovery code". Settings has no unlock — it offers create and replace, and replacing destroys the key that would have worked |
| Stray navigation tab | `settings/privacy-model` was the one route under `(app)` not declared `href: null`, so the bottom bar carried a fifth tab reading "privacy-model" |
| Pairing resume error | Pausing one pairing, pairing with someone else, then resuming the first showed `duplicate key value violates unique constraint "pairings_one_active_inviter"`. The invariant held; the wording was unusable |
| PIN setup | Entered once, so a single mistyped digit armed a lock the user could not open. Now asked twice |
| CI | Read nothing in `supabase/functions/` — now type-checked with Deno. It also now diffs the `(app)` route files against the Tabs layout, since a missing declaration silently adds a tab |

### Worth doing when you next touch the schema

`desires.rating` is `NOT NULL`, which is why a note had to carry a rating at
all. Making it nullable and having `trigger_reveal` ignore null ratings would
let a note exist with no rating — the honest representation. Today's fix
refuses instead, which is correct but means a note needs a rating first.

### Worth doing before mobile ships

An invite link cannot carry its code through sign-in. The accept screen is
inside the `(app)` group behind auth, and the root layout's redirect to
`/(auth)/sign-in` drops the query parameter, so a signed-out recipient arrives
with nothing. The share message now leads with the 8-character code, which
works in every case, but the link is only useful to someone already signed in.
When mobile ships the deep link starts resolving and the same gap appears
there.

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

`scripts/production-smoke-test.sql` runs ten checks, each inside its own
`begin; … rollback;`: the whole couple journey, the 24-hour expiry, new-user
onboarding, GDPR erasure, consent-chain ordering, the double-blind payload,
whether the reveal guard is actually deployed here, that one partner cannot
unlock the therapist export alone, that a new pairing does not inherit a
previous pairing's ratings, and that ending a pairing revokes the therapist
export.

Checks 7, 8 and 9 are the ones that earn their keep against production rather
than against CI. Check 7 reports `refuses_at_two = f` on a database that has
not had `20261025000004` applied — which is what it says about production
today. Check 8 covers the only safeguard on the clinical export: both
partners must consent, and one partner consenting twice must not satisfy it.

```bash
psql "$DATABASE_URL" -f scripts/production-smoke-test.sql
```

Afterwards confirm it left nothing behind:

```sql
select count(*) from auth.users where email like '%@yesyas.invalid';  -- expect 0
```

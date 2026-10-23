# Supabase setup for YesYas!

A full walkthrough from zero to a working local + hosted Supabase backend for
YesYas! v1. Follow these in order the first time; after that, `supabase start`
+ `supabase db reset` is your daily loop.

> **One-time housekeeping:** the starter originally used Firebase. Before
> running anything here, delete `firebase.js.txt` (it contains a public Firebase
> web API key from the previous project — safe in the sense that Firebase web
> keys are project identifiers, not secrets, but we're not using Firebase
> anymore, so just remove it). You can also delete the `yesyas-mvp` Firebase
> project from the Firebase console at your leisure.

---

## 1. Install the CLI and log in

The Supabase CLI is a separate tool from `@supabase/supabase-js`. Install it
once, globally.

```bash
# macOS
brew install supabase/tap/supabase

# Windows (via scoop)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Cross-platform via npm (if the above are inconvenient)
npm install -g supabase
```

Verify:

```bash
supabase --version
```

Log in so the CLI can create and link projects on your behalf:

```bash
supabase login
```

This opens a browser, asks you to sign in, and pastes an access token back
into the terminal.

---

## 2. Create a cloud project

You'll have two environments:

- **Staging** — for day-to-day testing with real Supabase infrastructure.
- **Production** — created closer to beta launch. Don't do this step yet.

Create a staging project:

1. Go to <https://supabase.com/dashboard/new> and pick an organization.
2. **Name:** `yesyas-staging`
3. **Database password:** use a password manager; save it somewhere secure.
4. **Region:** `us-east-1` for now. (EU region comes in v1.1 per the roadmap.)
5. **Pricing plan:** Free is fine for the 50-couple beta.

Once the project is provisioned, grab two values from the dashboard:

- **Project URL** — `Settings → API → Project URL`
- **anon (public) key** — `Settings → API → Project API keys → anon public`

---

## 3. Wire them into the app

```bash
cd "YesYAs App"
cp .env.example .env
```

Open `.env` and fill in:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

`.env` is already in `.gitignore` — never commit it.

Install JS deps (the package.json was updated to swap Firebase → Supabase):

```bash
npm install
```

---

## 4. Link and push the schema

From the repo root:

```bash
cd "YesYAs App"
supabase link --project-ref <your-project-ref>
```

You'll find the ref in the Supabase dashboard URL: `.../project/<ref>/...`.

Push the migrations:

```bash
supabase db push
```

This applies `supabase/migrations/*.sql` in order against your staging project.
You should see three migrations land: initial schema, RLS policies, reveal
engine.

Seed the Desire Library:

```bash
supabase db execute --file supabase/seed.sql
```

(Or paste `supabase/seed.sql` into the SQL editor on the Supabase dashboard.)

---

## 5. Run the RLS test

The single most important invariant is that **user A cannot read user B's
desires**. There's a test for that.

Start a local Supabase stack:

```bash
supabase start
```

First time takes a minute or two (pulls Postgres, Auth, Studio images). Then:

```bash
supabase test db
```

You should see eight tests pass. If any fail, stop and fix before doing
anything else — broken RLS would ship intimate data to the wrong person.

---

## 6. Run the app

With `.env` filled in:

```bash
npm start
```

Press `i` for iOS, `a` for Android, `w` for web. The sign-in screen should
load; enter an email, tap "Send me a sign-in link," and check your inbox
(or the Supabase dashboard `Auth → Users` for the link in local dev).

After sign-in you'll land on the home screen, which fetches a few Desire
Library items to prove the connection works.

---

## 7. Day-to-day commands

From inside `YesYAs App/`:

| What | Command |
|------|---------|
| Start local Supabase | `npm run db:start` |
| Stop local Supabase | `npm run db:stop` |
| Apply new migrations | `npm run db:push` |
| Reset local DB (drops + re-applies + seeds) | `npm run db:reset` |
| Run RLS + other SQL tests | `npm run db:test` |
| Security audit | `npm run audit` |

---

## 8. Adding a new migration

```bash
supabase migration new my_change_name
# edits supabase/migrations/<timestamp>_my_change_name.sql
npm run db:reset   # locally verify
npm run db:test    # locally verify RLS still holds
supabase db push   # apply to staging
```

Never edit a migration that has been pushed to staging — add a new one.

---

## 9. Deploying Edge Functions (week 7+)

Not needed yet. When you get to the AI journaling coach:

```bash
supabase functions new ai-coach
# write supabase/functions/ai-coach/index.ts
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy ai-coach
```

---

## 10. Troubleshooting

**`supabase db push` says there are "no local migrations"**
Check you ran it from `YesYAs App/`, not the repo root.

**RLS test says `relation desire_library_items does not exist`**
The seed wasn't applied. Run `supabase db reset` which applies migrations +
seed together.

**Email magic link never arrives**
Supabase's free tier has strict rate limits. Check `Auth → Users` on the
dashboard — the confirmation URL is visible there during local dev.

**"Cannot find module '@supabase/supabase-js'"**
You didn't run `npm install` after pulling the updated package.json.

---

## 11. When we're ready for production

- Create `yesyas-production` as a separate project.
- Use EAS Secrets for the production `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` so they bake into release builds.
- Turn on PITR (point-in-time recovery) on the production project.
- Enable `pg_cron` and schedule `select public.expire_old_reveals();` every
  15 minutes (the function is already in migration 3).
- Rotate the DB password and put it in 1Password/Bitwarden.
- Set up a second Supabase organization seat for at least one co-maintainer.

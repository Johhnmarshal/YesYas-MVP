# YesYas!

A privacy-first intimacy app for couples. Built with Expo (React Native + web)
and Supabase.

See `YesYas_MVP_Brief.docx` for the product brief, gap analysis, and full
architecture plan. See `docs/SUPABASE_SETUP.md` for the step-by-step backend
setup.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Set up Supabase (full walkthrough in docs/SUPABASE_SETUP.md)
cp .env.example .env
# edit .env with your Supabase URL + anon key

# 3. Run the app
npm start
```

Press `i` for iOS, `a` for Android, `w` for web.

---

## Project layout

```
YesYAs App/
├── app/                          # Expo Router entrypoints
│   ├── _layout.tsx               # auth gate + root stack
│   ├── (auth)/
│   │   └── sign-in.tsx           # email magic-link sign-in
│   └── (app)/
│       └── home.tsx              # signed-in home (WIP)
├── lib/
│   ├── supabase.ts               # Supabase client (AsyncStorage-backed session)
│   └── database.types.ts         # hand-written types matching the schema
├── supabase/
│   ├── config.toml               # CLI config (local dev ports, etc.)
│   ├── migrations/               # SQL schema + RLS + reveal engine
│   ├── tests/rls_test.sql        # critical RLS regression test
│   └── seed.sql                  # Desire Library starter content
├── docs/
│   └── SUPABASE_SETUP.md         # full backend setup walkthrough
└── YesYas_MVP_Brief.docx         # product brief
```

---

## The seven core tables

1. `profiles` — per-user settings (tone, content tier, locale). Mirrors `auth.users`.
2. `pairings` — exclusive 1:1 relationship. Max one active per user.
3. `desire_library_items` — curated, read-only content for rating.
4. `desires` — a user's ratings within a pairing (or solo). **Never visible to partner.**
5. `reveals` — mutually-matched items only. Expires after 24h.
6. `journal_entries` — solo-mode private journal.
7. `consent_events` — append-only, hash-chained audit log per user.

RLS enforces all cross-user boundaries. The reveal engine runs as a
`SECURITY DEFINER` function that can read both sides and writes only the
intersection.

---

## Scripts

| Command | What it does |
|---------|--------------|
| `npm start` | Start Expo dev server |
| `npm run ios` / `android` / `web` | Platform-specific dev |
| `npm run lint` | Expo lint |
| `npm run audit` | Security audit (prod deps only) |
| `npm run db:start` | Boot local Supabase stack |
| `npm run db:reset` | Drop + re-apply migrations + seed |
| `npm run db:test` | Run RLS regression test (pgTAP) |
| `npm run db:push` | Apply migrations to linked remote project |

---

## The non-negotiable invariant

> **User A must never be able to read user B's desires.**

The reveal engine writes only matches and mismatches — never raw desires.
`supabase/tests/rls_test.sql` asserts this. That test must stay green on every
commit. If it ever fails, halt the release.

---

## Next-up work

See `YesYas_MVP_Brief.docx` → "Next 90 days" for the full plan. The immediate
next milestones are:

- **Weeks 3-6:** pairing invite flow, rating UI, reveal state machine on top
  of `trigger_reveal()`, mismatch-bridge scripts.
- **Weeks 7-8:** solo journaling + AI coach Edge Function.
- **Weeks 9-10:** passkey auth, therapist-export PDF, WCAG 2.1 AA pass.
- **Weeks 11-12:** 50-couple closed beta.

---

## License

Private. Not for redistribution.

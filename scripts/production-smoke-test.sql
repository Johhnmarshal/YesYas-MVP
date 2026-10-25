-- Production smoke test: the whole couple journey, inside a transaction that
-- rolls back.
--
-- Why this exists: every component of YesYas! was individually verified long
-- before any of them had run together against the hosted project. On
-- 2026-10-24 production had 1 user, 0 pairings and 0 reveals — the pairing
-- RPCs did not even exist on it until five migrations were applied that day.
-- pgTAP covers the same ground, but against a throwaway database built from
-- migrations, which is exactly the thing that cannot catch a deployment that
-- drifted from the repo.
--
-- This runs the real sequence against whichever database you point it at:
--   sign-up -> profile trigger -> invite -> accept -> rate -> reveal
-- and asserts the reveal semantics, then throws it all away.
--
-- Run it:
--   psql "$DATABASE_URL" -f scripts/production-smoke-test.sql
--
-- Safe against production: everything happens inside begin/rollback, and the
-- final SELECT reports what happened. Verify afterwards that
-- `select count(*) from auth.users where email like '%@yesyas.invalid'` is 0.

begin;

-- Two throwaway users. The .invalid TLD is reserved and undeliverable, so
-- these can never receive mail even if a rollback were missed.
insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('aaaa1111-1111-4111-8111-111111111111', 'smoke-a@yesyas.invalid', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('bbbb2222-2222-4222-8222-222222222222', 'smoke-b@yesyas.invalid', 'x', now(), now(), now(), 'authenticated', 'authenticated');

set local role authenticated;

-- A creates an invite.
set local request.jwt.claims = '{"sub":"aaaa1111-1111-4111-8111-111111111111","role":"authenticated"}';
create temp table t_invite as select * from public.create_pairing_invite();

-- B accepts it.
set local request.jwt.claims = '{"sub":"bbbb2222-2222-4222-8222-222222222222","role":"authenticated"}';
create temp table t_pair as
  select public.accept_pairing_invite((select invite_code from t_invite)) as pairing_id;

-- Three items, chosen to exercise all three reveal outcomes:
--   item 1: A=5 B=5 -> match
--   item 2: A=5 B=3 -> curiosity bridge
--   item 3: A=5 B=1 -> hard veto, must not appear anywhere
insert into public.desires (user_id, pairing_id, library_item_id, rating)
select 'bbbb2222-2222-4222-8222-222222222222', (select pairing_id from t_pair), id,
       (array[5,3,1])[row_number() over (order by slug)]
from (select id, slug from public.desire_library_items order by slug limit 3) x;

set local request.jwt.claims = '{"sub":"aaaa1111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into public.desires (user_id, pairing_id, library_item_id, rating)
select 'aaaa1111-1111-4111-8111-111111111111', (select pairing_id from t_pair), id, 5
from (select id, slug from public.desire_library_items order by slug limit 3) x;

-- A marks ready (pending), then B marks ready (computes).
create temp table t_r1 as select * from public.trigger_reveal((select pairing_id from t_pair));
set local request.jwt.claims = '{"sub":"bbbb2222-2222-4222-8222-222222222222","role":"authenticated"}';
create temp table t_r2 as select * from public.trigger_reveal((select pairing_id from t_pair));

reset role;

-- Expected: t t pending computed 1 1 6 2  — anything else is a regression.
select
  (select invite_code is not null from t_invite)                        as invite_created,
  (select pairing_id is not null from t_pair)                           as pairing_accepted,
  (select status::text from t_r1)                                       as first_trigger,
  (select status::text from t_r2)                                       as second_trigger,
  (select summary->>'match_count' from public.reveals
     where pairing_id = (select pairing_id from t_pair))                as matches,
  (select summary->>'mismatch_count' from public.reveals
     where pairing_id = (select pairing_id from t_pair))                as bridges,
  (select count(*) from public.consent_events
     where pairing_id = (select pairing_id from t_pair))                as consent_rows,
  (select count(*) from public.profiles
     where id in ('aaaa1111-1111-4111-8111-111111111111',
                  'bbbb2222-2222-4222-8222-222222222222'))              as profiles_created;

rollback;

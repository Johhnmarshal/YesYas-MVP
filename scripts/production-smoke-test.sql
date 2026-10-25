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

-- ---------------------------------------------------------------------------
-- Second check: the 24-hour expiry destroys the reveal contents and keeps the
-- summary.
--
-- The PRD promises that a reveal's specific items disappear after a day while
-- "you had 7 matches" persists. That is the privacy claim the product is sold
-- on, and until 20261025000001 scheduled it, expire_old_reveals only ran when
-- somebody opened the app — so a couple who drifted away left their matched
-- items readable indefinitely.
--
-- Expected: status expired, has_matches f, has_mismatches f, match_count 2,
-- stamped t. match_count surviving while matches is null is the whole point.
-- ---------------------------------------------------------------------------

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('aaaa1111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','exp-a@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('bbbb2222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','exp-b@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now());

insert into public.pairings (id, inviter_user_id, invitee_user_id, status)
values ('dddd4444-4444-4444-4444-444444444444','aaaa1111-1111-4111-8111-111111111111','bbbb2222-2222-4222-8222-222222222222','active');

-- Computed 25 hours ago, so an hour past its window.
insert into public.reveals (pairing_id, status, triggered_by, both_ready_at, revealed_at, expires_at, matches, mismatches, summary)
values (
  'dddd4444-4444-4444-4444-444444444444', 'computed'::public.reveal_status,
  'aaaa1111-1111-4111-8111-111111111111',
  now() - interval '25 hours', now() - interval '25 hours', now() - interval '1 hour',
  '[{"slug":"a","title":"Secret match"},{"slug":"b","title":"Another"}]'::jsonb,
  '[{"slug":"c","title":"A bridge"}]'::jsonb,
  '{"match_count":2,"mismatch_count":1}'::jsonb
);

select public.expire_old_reveals_scheduled() as rows_expired;

select
  status::text                      as status,
  matches is not null               as has_matches,
  mismatches is not null            as has_mismatches,
  summary->>'match_count'           as match_count,
  summary->>'expired_at' is not null as stamped
from public.reveals
where pairing_id = 'dddd4444-4444-4444-4444-444444444444';

rollback;

-- ---------------------------------------------------------------------------
-- Third check: a brand-new user can get through onboarding.
--
-- app/_layout.tsx gates everything on profiles.onboarding_complete, and
-- onboarding/mode.tsx is the only thing that sets it. If RLS ever stopped
-- permitting that self-update, every new user would loop in onboarding with
-- no error — the update would simply affect zero rows. Nothing else in the
-- suite would notice, because the rest of the journey starts from users who
-- are already past it.
--
-- The last column is the other half: the same policy that lets a user write
-- their own profile must stop them writing anyone else's.
--
-- Expected: 1, f, t, playful, 120, 0.
-- ---------------------------------------------------------------------------

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('eeee5555-5555-4555-8555-555555555555','00000000-0000-0000-0000-000000000000','authenticated','authenticated','onboard@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now());

create temp table r1 as
  select count(*) as profile_created from public.profiles
  where id = 'eeee5555-5555-4555-8555-555555555555';

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeee5555-5555-4555-8555-555555555555","role":"authenticated"}';

create temp table r2 as
  select onboarding_complete as starts_complete from public.profiles
  where id = 'eeee5555-5555-4555-8555-555555555555';

-- Exactly what onboarding/mode.tsx writes on the final step.
update public.profiles
set tone_preference = 'playful'::public.tone_label,
    content_tier_preference = 'suggestive'::public.desire_tier,
    onboarding_complete = true
where id = 'eeee5555-5555-4555-8555-555555555555';

create temp table r3 as
  select onboarding_complete, tone_preference::text as tone from public.profiles
  where id = 'eeee5555-5555-4555-8555-555555555555';

create temp table r4 as
  select count(*) as library_visible from public.desire_library_items
  where active = true
    and tier in ('sensory'::public.desire_tier, 'suggestive'::public.desire_tier);

with attempt as (
  update public.profiles set onboarding_complete = false
  where id <> 'eeee5555-5555-4555-8555-555555555555' returning 1
)
select count(*) as rows_tampered into temp r5 from attempt;

reset role;

select (select profile_created from r1)     as profile_auto_created,
       (select starts_complete from r2)     as starts_complete,
       (select onboarding_complete from r3) as completed_after_update,
       (select tone from r3)                as tone_saved,
       (select library_visible from r4)     as library_at_default_tier,
       (select rows_tampered from r5)       as other_profiles_tampered;

rollback;

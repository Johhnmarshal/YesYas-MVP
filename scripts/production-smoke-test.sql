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

-- ---------------------------------------------------------------------------
-- Fourth check: UK GDPR erasure actually erases, and only the caller.
--
-- delete_user_account() is a compliance claim, and it was broken on arrival:
-- deleting a profile cascades the pairing away, which makes Postgres null the
-- partner's consent_events.pairing_id, and consent_events_immutable() blocked
-- that UPDATE. Erasure died on consent_events_pairing_id_fkey. Fixed in
-- 20261024000002; this is the standing check that it stays fixed.
--
-- Note pairing_status_after is null rather than 'ended'. The function marks
-- the pairing ended, then deleting the profile cascades the row away
-- entirely, so from the partner's side the pairing vanishes rather than
-- showing as ended. That is defensible — the erasing user's traces should go
-- — but it is behaviour worth knowing rather than discovering.
--
-- Expected: 4, 1, 1, 1, t, 0, 0, 0, 0, 0, 1, null.
-- ---------------------------------------------------------------------------

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('aaaa1111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','del-a@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  ('bbbb2222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','del-b@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa1111-1111-4111-8111-111111111111","role":"authenticated"}';
create temp table t_inv as select * from public.create_pairing_invite();
set local request.jwt.claims = '{"sub":"bbbb2222-2222-4222-8222-222222222222","role":"authenticated"}';
create temp table t_p as select public.accept_pairing_invite((select invite_code from t_inv)) as pid;

-- Give the erasing user a full footprint across every table that holds them.
set local request.jwt.claims = '{"sub":"aaaa1111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into public.desires (user_id, pairing_id, library_item_id, rating, note)
select 'aaaa1111-1111-4111-8111-111111111111', (select pid from t_p), id, 5, 'enc:v1:aa:bb:cc'
from (select id from public.desire_library_items order by slug limit 4) x;
insert into public.journal_entries (user_id, body)
values ('aaaa1111-1111-4111-8111-111111111111', 'enc:v1:dd:ee:ff');
insert into public.user_key_recovery (user_id, wrapped_key, salt, iterations)
values ('aaaa1111-1111-4111-8111-111111111111',
        'enc:v1:' || repeat('a',32) || ':' || repeat('b',64) || ':' || repeat('c',64),
        repeat('0',32), 150000);
insert into public.ai_flags (user_id, reason) values ('aaaa1111-1111-4111-8111-111111111111','test');

create temp table before as select
  (select count(*) from public.desires where user_id='aaaa1111-1111-4111-8111-111111111111') d,
  (select count(*) from public.journal_entries where user_id='aaaa1111-1111-4111-8111-111111111111') j,
  (select count(*) from public.user_key_recovery where user_id='aaaa1111-1111-4111-8111-111111111111') k,
  (select count(*) from public.consent_events where user_id='aaaa1111-1111-4111-8111-111111111111') c;

create temp table res as select public.delete_user_account() as ok;

reset role;

select (select d from before) as desires_before,
       (select j from before) as journal_before,
       (select k from before) as keyrecovery_before,
       (select c from before) as consent_before,
       (select ok from res)   as rpc_returned_true,
       (select count(*) from auth.users where id='aaaa1111-1111-4111-8111-111111111111') as auth_user_after,
       (select count(*) from public.profiles where id='aaaa1111-1111-4111-8111-111111111111') as profile_after,
       (select count(*) from public.desires where user_id='aaaa1111-1111-4111-8111-111111111111') as desires_after,
       (select count(*) from public.journal_entries where user_id='aaaa1111-1111-4111-8111-111111111111') as journal_after,
       (select count(*) from public.user_key_recovery where user_id='aaaa1111-1111-4111-8111-111111111111') as keyrecovery_after,
       (select count(*) from auth.users where id='bbbb2222-2222-4222-8222-222222222222') as partner_survives,
       (select status::text from public.pairings where id=(select pid from t_p)) as pairing_status_after;

rollback;

-- ---------------------------------------------------------------------------
-- Fifth check: the consent chain links correctly in the order it is read.
--
-- The chain is built by consent_events_chain() and read by lib/consent.ts,
-- which compares events[i].prev_hash to events[i-1].payload_hash positionally.
-- If those orders disagree the audit screen accuses the system of tampering
-- with an untouched log — the worst failure a screen whose only job is proving
-- integrity can have.
--
-- They did disagree. The trigger ordered by (created_at desc, id desc) and the
-- client read ascending, while created_at is the transaction timestamp and so
-- is identical for the three rows trigger_reveal writes in one statement,
-- leaving a random v4 UUID as the tie-break. Fixed in 20261025000003 by
-- chaining on seq.
--
-- Expected: 6, 2, 2, 4, 4, 6 — genesis_ok must equal genesis_rows and links_ok
-- must equal link_rows.
-- ---------------------------------------------------------------------------

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('aaaa1111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chain-a@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
       ('bbbb2222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chain-b@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa1111-1111-4111-8111-111111111111","role":"authenticated"}';
create temp table ti as select * from public.create_pairing_invite();
set local request.jwt.claims = '{"sub":"bbbb2222-2222-4222-8222-222222222222","role":"authenticated"}';
create temp table tp as select public.accept_pairing_invite((select invite_code from ti)) as pid;

insert into public.desires (user_id, pairing_id, library_item_id, rating)
select 'bbbb2222-2222-4222-8222-222222222222', (select pid from tp), id, 5
from (select id from public.desire_library_items order by slug limit 2) x;
set local request.jwt.claims = '{"sub":"aaaa1111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into public.desires (user_id, pairing_id, library_item_id, rating)
select 'aaaa1111-1111-4111-8111-111111111111', (select pid from tp), id, 5
from (select id from public.desire_library_items order by slug limit 2) x;

create temp table r1 as select * from public.trigger_reveal((select pid from tp));
set local request.jwt.claims = '{"sub":"bbbb2222-2222-4222-8222-222222222222","role":"authenticated"}';
create temp table r2 as select * from public.trigger_reveal((select pid from tp));

reset role;

with ordered as (
  select user_id, prev_hash, payload_hash, seq,
         lag(payload_hash) over (partition by user_id order by seq) as expected_prev,
         row_number()      over (partition by user_id order by seq) as rn
  from public.consent_events
)
select count(*)                                                                as rows_checked,
       count(*) filter (where rn = 1 and prev_hash is null)                    as genesis_ok,
       count(*) filter (where rn = 1)                                          as genesis_rows,
       count(*) filter (where rn > 1 and prev_hash is not distinct from expected_prev) as links_ok,
       count(*) filter (where rn > 1)                                          as link_rows,
       count(distinct seq)                                                     as distinct_seq
from ordered;

rollback;

-- ---------------------------------------------------------------------------
-- Sixth check: the reveal payload cannot say who wanted what.
--
-- This is the product. "Only overlapping desires are revealed — so neither
-- partner ever sees what the other said no to" is the promise the whole app
-- is built around, and it lives entirely in what trigger_reveal() chooses to
-- put in reveals.matches and reveals.mismatches. Both partners can read that
-- row, so anything written into it is shared.
--
-- The two partners are given deliberately distinguishable data: B rates 5/3/1
-- across three items while A rates all three 5, and both attach notes
-- containing a marker. A reveal that leaked ratings, notes or user ids would
-- show it.
--
-- Expected: no "rating" key, no marker from either note, no user id, and a
-- summary of counts only. mismatches carries no description on purpose —
-- less detail for an item only one partner wanted.
--
-- Expected row:
--   description,library_item_id,slug,tier,title | library_item_id,slug,tier,title
--   | f | f | f | {"match_count": 1, "mismatch_count": 1}
-- ---------------------------------------------------------------------------

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('aaaa1111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p1@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
       ('bbbb2222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','p2@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaa1111-1111-4111-8111-111111111111","role":"authenticated"}';
create temp table ti as select * from public.create_pairing_invite();
set local request.jwt.claims = '{"sub":"bbbb2222-2222-4222-8222-222222222222","role":"authenticated"}';
create temp table tp as select public.accept_pairing_invite((select invite_code from ti)) as pid;

-- B: 5 (match), 3 (bridge), 1 (hard veto). A: all 5. Notes carry a marker.
insert into public.desires (user_id, pairing_id, library_item_id, rating, note)
select 'bbbb2222-2222-4222-8222-222222222222', (select pid from tp), id,
       (array[5,3,1])[rn], 'enc:v1:BSECRET'
from (select id, row_number() over (order by slug) rn
      from public.desire_library_items order by slug limit 3) x;

set local request.jwt.claims = '{"sub":"aaaa1111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into public.desires (user_id, pairing_id, library_item_id, rating, note)
select 'aaaa1111-1111-4111-8111-111111111111', (select pid from tp), id, 5, 'enc:v1:ASECRET'
from (select id from public.desire_library_items order by slug limit 3) x;

create temp table r1 as select * from public.trigger_reveal((select pid from tp));
set local request.jwt.claims = '{"sub":"bbbb2222-2222-4222-8222-222222222222","role":"authenticated"}';
create temp table r2 as select * from public.trigger_reveal((select pid from tp));

reset role;

select
  (select string_agg(distinct k, ',' order by k)
     from public.reveals r, lateral jsonb_array_elements(r.matches) m, lateral jsonb_object_keys(m) k
    where r.pairing_id = (select pid from tp))                       as match_keys,
  (select string_agg(distinct k, ',' order by k)
     from public.reveals r, lateral jsonb_array_elements(r.mismatches) m, lateral jsonb_object_keys(m) k
    where r.pairing_id = (select pid from tp))                       as bridge_keys,
  (select (matches::text ~ '"rating"' or mismatches::text ~ '"rating"')
     from public.reveals where pairing_id = (select pid from tp))    as leaks_rating,
  (select (matches::text ~* 'secret' or mismatches::text ~* 'secret')
     from public.reveals where pairing_id = (select pid from tp))    as leaks_note,
  (select (matches::text ~ 'aaaa1111|bbbb2222' or mismatches::text ~ 'aaaa1111|bbbb2222')
     from public.reveals where pairing_id = (select pid from tp))    as leaks_user_id,
  (select summary::text from public.reveals where pairing_id = (select pid from tp)) as summary;

rollback;

-- ---------------------------------------------------------------------------
-- Seventh check: the weekly reveal cannot be spent on an empty one, AND the
-- guard that enforces that is actually deployed here.
--
-- This check exists for two reasons.
--
-- The first is the bug. trigger_reveal() enforced a 7-day cadence but never
-- checked the caller had rated anything, so the most likely first thing a
-- couple does — both tapping "ready" to see what the feature does — returned
-- a valid reveal of {"match_count": 0, "mismatch_count": 0} and then refused
-- every further attempt for a week with P0001. A week is a long time to wait
-- to discover the product is not broken.
--
-- The second is deployment drift, which is the whole point of running this
-- file against production rather than trusting pgTAP. pgTAP builds a database
-- from the migrations in the repo, so it can only ever tell you the repo is
-- self-consistent. It cannot tell you the hosted project got the migration.
-- When 20261025000004 was written, production had the 180-item library, 14
-- migrations and both Edge Functions live — and still ran the old
-- trigger_reveal. Only a call against the real database says so.
--
-- Expected: refuses_at_two = t, no_half_consumed_state = t, allows_at_three = t.
--
-- refuses_at_two = f means this database has not had 20261025000004 applied;
-- run `supabase db push`. Measured against production on 2026-10-25 before
-- that push, this check reported exactly that:
--
--   refuses_at_two   f
--   refusal_detail   ALLOWED - 20261025000004 is not applied to this database
--   allows_at_three  t
--
-- which is the check doing its job.
-- ---------------------------------------------------------------------------

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('cccc3333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','g1@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
       ('dddd4444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','g2@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now());

create temp table guard_result (step text, passed boolean, detail text);
grant insert, select on guard_result to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"cccc3333-3333-4333-8333-333333333333","role":"authenticated"}';
create temp table gi as select * from public.create_pairing_invite();
set local request.jwt.claims = '{"sub":"dddd4444-4444-4444-8444-444444444444","role":"authenticated"}';
create temp table gp as select public.accept_pairing_invite((select invite_code from gi)) as pid;

-- The partner is fully rated, so any refusal below is about the caller alone.
insert into public.desires (user_id, pairing_id, library_item_id, rating)
select 'dddd4444-4444-4444-8444-444444444444', (select pid from gp), id, 5
from (select id from public.desire_library_items order by slug limit 3) x;

-- The caller rates two: one short of the threshold.
set local request.jwt.claims = '{"sub":"cccc3333-3333-4333-8333-333333333333","role":"authenticated"}';
insert into public.desires (user_id, pairing_id, library_item_id, rating)
select 'cccc3333-3333-4333-8333-333333333333', (select pid from gp), id, 5
from (select id from public.desire_library_items order by slug limit 2) x;

do $$
declare
  v_pid uuid;
begin
  select pid into v_pid from gp;

  begin
    perform public.trigger_reveal(v_pid);
    insert into guard_result values ('refuses_at_two', false,
      'ALLOWED - 20261025000004 is not applied to this database');
  exception
    when sqlstate 'P0002' then
      insert into guard_result values ('refuses_at_two', true, sqlerrm);
    when others then
      insert into guard_result values ('refuses_at_two', false,
        'wrong error: ' || sqlstate || ' / ' || sqlerrm);
  end;

  -- Measured here, not at the end: the allowed call below legitimately writes
  -- a readiness row, so a count taken afterwards reads 1 whether the guard is
  -- present or not. A guarded refusal must leave nothing.
  insert into guard_result
  select 'readiness_after_refusal',
         (select count(*) from public.reveal_readiness where pairing_id = v_pid) = 0,
         (select count(*)::text from public.reveal_readiness where pairing_id = v_pid);

  -- Third rating, then the same call must be allowed through.
  insert into public.desires (user_id, pairing_id, library_item_id, rating)
  select 'cccc3333-3333-4333-8333-333333333333', v_pid, id, 5
  from (select id from public.desire_library_items order by slug limit 3) x
  on conflict (user_id, pairing_id, library_item_id) where pairing_id is not null
  do nothing;

  begin
    perform public.trigger_reveal(v_pid);
    insert into guard_result values ('allows_at_three', true, null);
  exception when others then
    insert into guard_result values ('allows_at_three', false,
      sqlstate || ' / ' || sqlerrm);
  end;
end $$;

reset role;

select
  (select passed from guard_result where step = 'refuses_at_two')          as refuses_at_two,
  (select passed from guard_result where step = 'readiness_after_refusal') as no_half_consumed_state,
  (select passed from guard_result where step = 'allows_at_three')         as allows_at_three,
  (select detail from guard_result where step = 'refuses_at_two')          as refusal_detail;

rollback;

-- ---------------------------------------------------------------------------
-- Eighth check: one partner cannot unlock the therapist export alone.
--
-- The clinical summary is the most consequential thing this app emits: a
-- document about two people's intimate life, written for a third party. Its
-- whole safeguard is that both partners must consent, and the gate is
-- request_therapist_export()'s both_consented flag — the UI prints "Dual
-- Partner Consent Verified" on the strength of it, and the on-device fallback
-- report softens its wording precisely because it cannot check it.
--
-- consent_events is self-read only under RLS (one policy, consent_self_read,
-- user_id = auth.uid()), so the partner's consent row is invisible to the
-- caller. Only this SECURITY DEFINER function and the service-role Edge
-- Function can see both sides. That makes the function the single point where
-- the safeguard could silently invert, and nothing else tests it.
--
-- The double tap matters most: if consenting twice satisfied the gate, one
-- partner could export a joint clinical document about the other on their own.
--
-- Expected: f, f, t, 3 rows, 2 distinct consenters.
-- ---------------------------------------------------------------------------

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('e1e1e1e1-1111-4111-8111-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tx1@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
       ('f2f2f2f2-2222-4222-8222-ffffffffffff','00000000-0000-0000-0000-000000000000','authenticated','authenticated','tx2@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1e1e1e1-1111-4111-8111-eeeeeeeeeeee","role":"authenticated"}';
create temp table xi as select * from public.create_pairing_invite();
set local request.jwt.claims = '{"sub":"f2f2f2f2-2222-4222-8222-ffffffffffff","role":"authenticated"}';
create temp table xp as select public.accept_pairing_invite((select invite_code from xi)) as pid;

-- A consents, then consents again. Neither may open the gate.
set local request.jwt.claims = '{"sub":"e1e1e1e1-1111-4111-8111-eeeeeeeeeeee","role":"authenticated"}';
create temp table c1  as select * from public.request_therapist_export((select pid from xp));
create temp table c1b as select * from public.request_therapist_export((select pid from xp));

-- B consents. Now, and only now, it opens.
set local request.jwt.claims = '{"sub":"f2f2f2f2-2222-4222-8222-ffffffffffff","role":"authenticated"}';
create temp table c2 as select * from public.request_therapist_export((select pid from xp));

reset role;

select
  (select both_consented from c1)  as a_alone_expect_f,
  (select both_consented from c1b) as a_twice_expect_f,
  (select both_consented from c2)  as both_expect_t,
  (select count(*) from public.consent_events
     where pairing_id = (select pid from xp)
       and event_type = 'therapist_export')             as export_consent_rows,
  (select count(distinct user_id) from public.consent_events
     where pairing_id = (select pid from xp)
       and event_type = 'therapist_export')             as distinct_consenters;

rollback;

-- ---------------------------------------------------------------------------
-- Ninth check: a new pairing does not inherit a previous pairing's ratings.
--
-- accept_pairing_invite copies desires into the new pairing, which is what
-- makes solo exploration carry over when a couple pairs for the first time.
-- The filter on that copy is `where d.pairing_id is null` — solo ratings only.
--
-- That filter is load-bearing in a way the code does not announce. Widening it
-- to carry a previous pairing's ratings forward would look like a kindness:
-- end a pairing, pair again, and your shared library is still there instead of
-- 180 unrated items. But the next pairing is not necessarily with the same
-- person, so it would move one relationship's intimate ratings into another.
-- There is no consent for that and no way to undo it.
--
-- So this asserts the opposite of a convenience: ratings made inside a pairing
-- MUST NOT appear in the next one. The end-pairing confirmation tells users
-- this happens; this is what keeps it true.
--
-- Expected: old_pairing 6, new_pairing 0, solo 0.
-- new_pairing > 0 means someone widened the copy and a privacy boundary has
-- gone with it.
-- ---------------------------------------------------------------------------

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('9a9a9a9a-1111-4111-8111-999999999999','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c1@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
       ('8b8b8b8b-2222-4222-8222-888888888888','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c2@yesyas.invalid','',now(),'{}'::jsonb,'{}'::jsonb,now(),now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"9a9a9a9a-1111-4111-8111-999999999999","role":"authenticated"}';
create temp table q1 as select * from public.create_pairing_invite();
set local request.jwt.claims = '{"sub":"8b8b8b8b-2222-4222-8222-888888888888","role":"authenticated"}';
create temp table pp1 as select public.accept_pairing_invite((select invite_code from q1)) as pid;

-- Rated only inside the pairing. No solo ratings anywhere, so nothing is
-- entitled to carry over.
insert into public.desires (user_id, pairing_id, library_item_id, rating)
select '8b8b8b8b-2222-4222-8222-888888888888', (select pid from pp1), id, 5
from (select id from public.desire_library_items order by slug limit 3) x;
set local request.jwt.claims = '{"sub":"9a9a9a9a-1111-4111-8111-999999999999","role":"authenticated"}';
insert into public.desires (user_id, pairing_id, library_item_id, rating)
select '9a9a9a9a-1111-4111-8111-999999999999', (select pid from pp1), id, 5
from (select id from public.desire_library_items order by slug limit 3) x;

select public.update_pairing_status((select pid from pp1), 'ended'::public.pairing_status);

create temp table q2 as select * from public.create_pairing_invite();
set local request.jwt.claims = '{"sub":"8b8b8b8b-2222-4222-8222-888888888888","role":"authenticated"}';
create temp table pp2 as select public.accept_pairing_invite((select invite_code from q2)) as pid;

reset role;

select
  (select count(*) from public.desires
     where pairing_id = (select pid from pp1))            as old_pairing_keeps,
  (select count(*) from public.desires
     where pairing_id = (select pid from pp2))            as new_pairing_inherits,
  (select count(*) from public.desires
     where pairing_id is null
       and user_id in ('9a9a9a9a-1111-4111-8111-999999999999',
                       '8b8b8b8b-2222-4222-8222-888888888888')) as solo;

rollback;

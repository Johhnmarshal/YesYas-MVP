-- RLS regression test for YesYas! v1
--
-- Run with: `supabase test db` (requires `supabase start` first).
-- Uses the pgTAP extension that Supabase bundles in its test runner.
--
-- The core invariant: USER A MUST NOT BE ABLE TO READ USER B'S DESIRES.
-- If this test ever fails, halt the release.

begin;
select plan(46);

-- ---------- fixtures ----------
-- Create four auth users directly in auth.users. The on_auth_user_created
-- trigger will create matching profiles rows.
insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'a@yesyas.test', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'b@yesyas.test', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'c@yesyas.test', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'd@yesyas.test', 'x', now(), now(), now(), 'authenticated', 'authenticated');

update public.profiles set display_name = 'Alex' where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Blair' where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set display_name = 'Casey' where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set display_name = 'Devon' where id = '44444444-4444-4444-4444-444444444444';

-- Grab a library item to rate.
-- (Seed was applied; pick the first suggestive item.)
do $$
declare
  v_item uuid;
  v_pair uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
begin
  select id into v_item from public.desire_library_items where slug = 'written-note-of-appreciation';

  -- Create an active pairing between A and B.
  insert into public.pairings (id, inviter_user_id, invitee_user_id, status)
  values (v_pair, '11111111-1111-1111-1111-111111111111',
                  '22222222-2222-2222-2222-222222222222', 'active');

  -- Insert a desire rating as each user (bypassing RLS here — we're setting
  -- up data as the superuser running the test).
  insert into public.desires (user_id, pairing_id, library_item_id, rating, note)
  values ('11111111-1111-1111-1111-111111111111', v_pair, v_item, 5, 'A secret');
  insert into public.desires (user_id, pairing_id, library_item_id, rating, note)
  values ('22222222-2222-2222-2222-222222222222', v_pair, v_item, 4, 'B secret');
end;
$$;

-- ---------- act as user A ----------
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1. A sees exactly their own desire row.
select is(
  (select count(*)::int from public.desires),
  1,
  'A sees only their own desire row (1 of 2)'
);

-- 2. A's own row has their note.
select is(
  (select note from public.desires limit 1),
  'A secret',
  'A can read their own note'
);

-- 3. A cannot read B's note under any filter.
select is(
  (select count(*)::int from public.desires where note = 'B secret'),
  0,
  'A cannot read B''s note'
);

-- 4. A can read their own profile.
select is(
  (select count(*)::int from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  1,
  'A can read own profile'
);

-- 5. A can read B's limited profile via the active pairing.
select is(
  (select count(*)::int from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  1,
  'A can read B''s profile (active pairing)'
);

-- ---------- switch to user B ----------
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- 6. B also sees only their own desire.
select is(
  (select count(*)::int from public.desires),
  1,
  'B sees only their own desire row (1 of 2)'
);

-- 7. B cannot read A's note.
select is(
  (select count(*)::int from public.desires where note = 'A secret'),
  0,
  'B cannot read A''s note'
);

-- ---------- anonymous user ----------
-- Clear the JWT claims first: `set local role anon` only changes the DB role,
-- but auth.uid() reads from request.jwt.claims, which still holds user B's
-- sub from the previous block. Without clearing it, anon queries still behave
-- as if B were signed in and the RLS policies would pass the wrong row.
set local "request.jwt.claim.sub" = '';
set local "request.jwt.claims" = '';
set local role anon;

-- 8. Unauthenticated users see zero desires.
select is(
  (select count(*)::int from public.desires),
  0,
  'Unauthenticated users see zero desires'
);

-- ---------- security & RPC remediation tests (assertions 9-24) ----------
-- Add additional desires as superuser to test Curiosity Bridge (5 vs 3) and hard veto (5 vs 1).
reset role;
do $$
declare
  v_pair uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_bridge_item uuid;
  v_veto_item uuid;
  v_retired_item uuid;
begin
  select id into v_bridge_item from public.desire_library_items where slug = 'unrushed-kissing';
  select id into v_veto_item from public.desire_library_items where slug = 'slow-undressing';

  -- Curiosity Bridge item: A rates 5, B rates 3
  insert into public.desires (user_id, pairing_id, library_item_id, rating, note)
  values
    ('11111111-1111-1111-1111-111111111111', v_pair, v_bridge_item, 5, 'A bridge note'),
    ('22222222-2222-2222-2222-222222222222', v_pair, v_bridge_item, 3, 'B bridge note');

  -- Hard Veto item: A rates 5, B rates 1 (rejection!)
  insert into public.desires (user_id, pairing_id, library_item_id, rating, note)
  values
    ('11111111-1111-1111-1111-111111111111', v_pair, v_veto_item, 5, 'A veto note'),
    ('22222222-2222-2222-2222-222222222222', v_pair, v_veto_item, 1, 'B veto note');

  -- Retired item (20261031000001): both rate 5. It must never reach the reveal,
  -- because neither user can see or change that rating in the app any more.
  select id into v_retired_item from public.desire_library_items
  where slug = 'silent-eye-blink-sync';
  insert into public.desires (user_id, pairing_id, library_item_id, rating)
  values
    ('11111111-1111-1111-1111-111111111111', v_pair, v_retired_item, 5),
    ('22222222-2222-2222-2222-222222222222', v_pair, v_retired_item, 5);
end;
$$;

-- Switch back to user A
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 9. Direct client INSERT into public.consent_events is denied by RLS.
select throws_ok(
  $$insert into public.consent_events (user_id, event_type, payload_hash)
    values ('11111111-1111-1111-1111-111111111111', 'reveal_triggered', 'fake')$$,
  '42501',
  null,
  'Direct client INSERT into consent_events is denied by RLS'
);

-- 10. Direct client INSERT into public.pairings is denied by RLS.
select throws_ok(
  $$insert into public.pairings (inviter_user_id, status)
    values ('11111111-1111-1111-1111-111111111111', 'pending')$$,
  '42501',
  null,
  'Direct client INSERT into pairings is denied by RLS'
);

-- 11. Calling public.trigger_reveal(v_pair) as User A succeeds without SQLSTATE 42702 and returns status = 'pending'.
select is(
  (select r.status from public.trigger_reveal('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid) r),
  'pending'::public.reveal_status,
  'trigger_reveal as User A succeeds without SQLSTATE 42702 and returns pending'
);

-- 12. Calling public.trigger_reveal(v_pair) a second time as User A is idempotent.
select is(
  (
    with second_call as (
      select r.reveal_id from public.trigger_reveal('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid) r
    )
    select count(*)::int
    from public.reveals rev
    join second_call sc on sc.reveal_id = rev.id
    where rev.pairing_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
      and rev.status = 'pending'
  ),
  1,
  'Second trigger_reveal call by User A is idempotent (1 pending reveal row with same reveal_id)'
);

-- 13. Calling public.withdraw_reveal(v_pair) as User A removes the pending reveal (count(*) = 0).
select public.withdraw_reveal('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
select is(
  (select count(*)::int from public.reveals where pairing_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid and status = 'pending'),
  0,
  'withdraw_reveal removes the pending reveal row'
);

-- Re-trigger as User A, then switch to User B and call trigger_reveal(v_pair).
select public.trigger_reveal('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- 14. Calling public.trigger_reveal(v_pair) as User B transitions the existing reveal row to status = 'computed'.
select is(
  (select r.status from public.trigger_reveal('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid) r),
  'computed'::public.reveal_status,
  'trigger_reveal as User B transitions existing reveal row to computed'
);

-- 15. reveals.matches contains the mutually high-rated item (both >= 4) with expected keys and NO a_rating or b_rating.
select is(
  (
    select
      jsonb_array_length(matches) = 1
      and (matches->0->>'slug') = 'written-note-of-appreciation'
      and (matches->0 ? 'library_item_id')
      and (matches->0 ? 'title')
      and (matches->0 ? 'description')
      and (matches->0 ? 'tier')
      and not (matches->0 ? 'a_rating')
      and not (matches->0 ? 'b_rating')
    from public.reveals
    where pairing_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
      and status = 'computed'
  ),
  true,
  'reveals.matches contains mutual >=4 item with metadata and excludes a_rating/b_rating'
);

-- 16. reveals.mismatches (Curiosity Bridge) includes the (5, 3) item without a_rating, b_rating, or direction.
select is(
  (
    select
      jsonb_array_length(mismatches) = 1
      and (mismatches->0->>'slug') = 'unrushed-kissing'
      and (mismatches->0 ? 'library_item_id')
      and (mismatches->0 ? 'title')
      and (mismatches->0 ? 'tier')
      and not (mismatches->0 ? 'a_rating')
      and not (mismatches->0 ? 'b_rating')
      and not (mismatches->0 ? 'direction')
    from public.reveals
    where pairing_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
      and status = 'computed'
  ),
  true,
  'reveals.mismatches (Curiosity Bridge) includes (5,3) item without ratings or direction'
);

-- 17. Non-negotiable rejection privacy: when A rates 5 and B rates 1 (or 2), item is completely excluded from BOTH matches and mismatches.
select is(
  (
    select
      not exists (
        select 1 from jsonb_array_elements(matches) m where m->>'slug' = 'slow-undressing'
      )
      and not exists (
        select 1 from jsonb_array_elements(mismatches) mm where mm->>'slug' = 'slow-undressing'
      )
    from public.reveals
    where pairing_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
      and status = 'computed'
  ),
  true,
  'Rejection privacy: (5,1) item is completely excluded from both matches and mismatches'
);

-- 17b. A retired item both partners rated 5 is excluded from the reveal. Test 15
--      already pins matches to exactly one item; this names the reason.
select is(
  (
    select not exists (
      select 1 from jsonb_array_elements(matches || mismatches) m
      where m->>'slug' = 'silent-eye-blink-sync'
    )
    from public.reveals
    where pairing_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
      and status = 'computed'
  ),
  true,
  'a retired library item never surfaces in a reveal, even when both rated it 5'
);

-- 18. trigger_reveal writes reveal_triggered and reveal_revealed rows to public.consent_events with valid non-null payload_hash and prev_hash chain.
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (
    with events as (
      select event_type, payload_hash, prev_hash,
             row_number() over (order by created_at asc, id asc) as rn
      from public.consent_events
      where user_id = '11111111-1111-1111-1111-111111111111'::uuid
    )
    select
      count(*) >= 2
      and bool_and(payload_hash is not null and length(payload_hash) = 64)
      and exists (select 1 from events where event_type = 'reveal_triggered')
      and exists (select 1 from events where event_type = 'reveal_revealed' and prev_hash is not null)
    from events
  ),
  true,
  'trigger_reveal writes hash-chained reveal_triggered and reveal_revealed consent_events'
);

-- 19. UPDATE and DELETE on public.consent_events raise exception 'consent_events is append-only'.
reset role;
select throws_ok(
  $$update public.consent_events set payload_hash = 'tampered'$$,
  'P0001',
  'consent_events is append-only',
  'consent_events blocks UPDATE and DELETE as append-only'
);

-- ---------- User C & User D pairing handshake & solo graduation (assertions 20-24) ----------
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

-- User C rates a solo desire (pairing_id IS NULL)
insert into public.desires (user_id, pairing_id, library_item_id, rating, note)
select
  '33333333-3333-3333-3333-333333333333'::uuid,
  null,
  id,
  5,
  'C solo note'
from public.desire_library_items
where slug = 'written-note-of-appreciation';

-- 20. User C calls create_pairing_invite(), returning a non-null 8-char invite_code.
select is(
  (select length(invite_code) from public.create_pairing_invite()),
  8,
  'User C create_pairing_invite returns a non-null 8-character invite_code'
);

-- 21. User C attempting accept_pairing_invite(code) on their own invite raises an exception ('inviter cannot accept own invite').
select throws_ok(
  $$select public.accept_pairing_invite(
      (select invite_code from public.pairings where inviter_user_id = '33333333-3333-3333-3333-333333333333'::uuid and status = 'pending' limit 1)
    )$$,
  '22023',
  'inviter cannot accept own invite',
  'Inviter cannot accept their own pairing invite'
);

-- Switch to User D to preview and accept User C's invite.
do $$
declare
  v_code text;
begin
  select invite_code into v_code
  from public.pairings
  where inviter_user_id = '33333333-3333-3333-3333-333333333333'::uuid
    and status = 'pending'
  limit 1;
  perform set_config('yesyas.test_invite_code', v_code, true);
end;
$$;

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

-- 22. User D calling preview_pairing_invite(code) returns C's pairing preview; accept_pairing_invite(code) activates the pairing and consumes invite_code.
do $$
declare
  v_inviter_name text;
  v_pair_id uuid;
begin
  select inviter_display_name into v_inviter_name
  from public.preview_pairing_invite(current_setting('yesyas.test_invite_code'));

  select public.accept_pairing_invite(current_setting('yesyas.test_invite_code'))
    into v_pair_id;

  perform set_config('yesyas.preview_inviter_name', coalesce(v_inviter_name, ''), true);
  perform set_config('yesyas.accepted_pair_id', v_pair_id::text, true);
end;
$$;

select is(
  (
    select
      current_setting('yesyas.preview_inviter_name') = 'Casey'
      and p.status = 'active'
      and p.invite_code is null
      and p.invitee_user_id = '44444444-4444-4444-4444-444444444444'::uuid
    from public.pairings p
    where p.id = current_setting('yesyas.accepted_pair_id')::uuid
  ),
  true,
  'User D previews and accepts invite, activating pairing and consuming invite_code'
);

-- 23. Accepting the pairing automatically graduates User C's solo desire into the new pairing_id.
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is(
  (
    select count(*)::int
    from public.desires d
    join public.pairings p on p.id = d.pairing_id
    where d.user_id = '33333333-3333-3333-3333-333333333333'::uuid
      and p.inviter_user_id = '33333333-3333-3333-3333-333333333333'::uuid
      and p.status = 'active'
  ),
  1,
  'Accepting pairing automatically graduates User C''s solo desire into the active pairing_id'
);

-- 24. Calling request_therapist_export(new_pair_id) as User C returns both_consented = false, and then calling it as User D returns both_consented = true.
do $$
declare
  v_new_pair uuid;
  v_c_both boolean;
begin
  select id into v_new_pair
  from public.pairings
  where inviter_user_id = '33333333-3333-3333-3333-333333333333'::uuid
    and status = 'active'
  limit 1;

  perform set_config('yesyas.new_pair_id', v_new_pair::text, true);
  select both_consented into v_c_both from public.request_therapist_export(v_new_pair);
  perform set_config('yesyas.c_both_consented', v_c_both::text, true);
end;
$$;

set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select is(
  (
    select
      current_setting('yesyas.c_both_consented') = 'false'
      and r.both_consented = true
      and r.export_event_id is not null
    from public.request_therapist_export(current_setting('yesyas.new_pair_id')::uuid) r
  ),
  true,
  'request_therapist_export returns both_consented=false for first partner and true for second partner'
);

-- ---------- user_key_recovery: wrapped-key backups are self-only (assertions 25-27) ----------
-- A and B are an ACTIVE pairing, so these also prove the table did not inherit
-- the partner-read policy that public.profiles deliberately has.
reset role;

insert into public.user_key_recovery (user_id, wrapped_key, salt, iterations)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'enc:v1:' || repeat('a', 32) || ':' || repeat('b', 64) || ':' || repeat('c', 64),
    repeat('0', 32),
    150000
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'enc:v1:' || repeat('d', 32) || ':' || repeat('e', 64) || ':' || repeat('f', 64),
    repeat('1', 32),
    150000
  );

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 25. A sees exactly one wrapped key: their own.
select is(
  (select count(*)::int from public.user_key_recovery),
  1,
  'A sees only their own wrapped key backup (1 of 2)'
);

-- 26. A cannot read their active partner's wrapped key, even by explicit id.
select is(
  (
    select count(*)::int from public.user_key_recovery
    where user_id = '22222222-2222-2222-2222-222222222222'
  ),
  0,
  'A cannot read an active partner''s wrapped key backup'
);

-- 27. A cannot plant a wrapped key for anybody else.
select throws_ok(
  $$insert into public.user_key_recovery (user_id, wrapped_key, salt, iterations)
    values ('33333333-3333-3333-3333-333333333333',
            'enc:v1:00000000000000000000000000000000:aa:bb',
            '00000000000000000000000000000000', 150000)$$,
  '42501',
  null,
  'A cannot write a wrapped key backup for another user'
);

-- ---------- 28. Reveal Cadence Enforcement (R-03) ----------
-- The pairing between A and B already has a computed reveal in the test fixtures.
-- Calling trigger_reveal again must immediately throw the 7-day cadence exception.
select throws_ok(
  $$select * from public.trigger_reveal('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
  'P0001',
  null,
  'trigger_reveal rejects repeated reveals within 7-day cadence limit'
);

-- ---------- 29. Real Account Deletion under UK GDPR (R-02) ----------
-- Act as user D (44444444-4444-4444-4444-444444444444).
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select is(
  (select public.delete_user_account()),
  true,
  'delete_user_account succeeds and cleans up user D'
);

-- ---------- 30. consent_events is append-only again once erasure finishes ----------
-- The counterpart to assertion 19, which only covers UPDATE. DELETE is the verb
-- that delete_user_account() unlocks by setting yesyas.account_deletion, and
-- that flag is transaction-local — so with assertion 29 above having just run
-- it, this is exactly where a flag left open would show. Needs `reset role`
-- for the same reason assertion 19 does: under RLS the statement would match
-- no rows, the row trigger would never fire, and nothing would be raised.
reset role;
select throws_ok(
  $$delete from public.consent_events$$,
  'P0001',
  'consent_events is append-only',
  'consent_events blocks DELETE once delete_user_account has cleared its flag'
);

-- ---------- 31-32. is_pairing_member only answers about the caller ----------
-- Before 20261024000004 this returned membership for ANY (pairing, user) pair
-- with no reference to the caller: an oracle for anyone holding two UUIDs.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  public.is_pairing_member(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid
  ),
  true,
  'is_pairing_member confirms the caller''s own membership'
);

select is(
  public.is_pairing_member(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid
  ),
  false,
  'is_pairing_member refuses to answer about another user, even a real partner'
);

-- ---------- 33. expire_old_reveals rejects a caller with no JWT ----------
-- Grants alone would not catch this: the role keeps EXECUTE, so what is being
-- tested is the function's own guard.
set local request.jwt.claim.sub = '';
set local request.jwt.claims = '{}';

select throws_ok(
  $$select public.expire_old_reveals()$$,
  '28000',
  null,
  'expire_old_reveals rejects a caller with no authenticated identity'
);

-- ---------- 34. The consent chain links correctly in the order it is read ----------
-- The chain is built by consent_events_chain() and read back by
-- lib/consent.ts, which compares events[i].prev_hash to events[i-1].payload_hash
-- positionally. If those two orders ever disagree, the audit screen accuses
-- the system of tampering with an untouched log.
--
-- They did disagree: the trigger ordered by (created_at desc, id desc) while
-- the client read (created_at asc, id asc), and created_at is the transaction
-- timestamp — constant for the three rows trigger_reveal writes in one
-- statement, leaving a random v4 UUID as the only tie-break. Fixed in
-- 20261025000003 by chaining on seq, a monotonic insertion order.
--
-- This asserts the property rather than the implementation: every non-genesis
-- row's prev_hash must equal the payload_hash of the row before it in read
-- order, and each user must have exactly one genesis row.
reset role;
select is(
  (
    with ordered as (
      select user_id, prev_hash, payload_hash,
             lag(payload_hash) over (partition by user_id order by seq) as expected_prev,
             row_number() over (partition by user_id order by seq) as rn
      from public.consent_events
    )
    select
      count(*) filter (where rn = 1 and prev_hash is not null) = 0
      and count(*) filter (where rn > 1 and prev_hash is distinct from expected_prev) = 0
    from ordered
  ),
  true,
  'consent chain links correctly when read in seq order, including rows written by one statement'
);

-- ---------- assertions 35-37: a reveal must have something to compare ----------
--
-- trigger_reveal enforced the 7-day cadence but never checked the caller had
-- rated anything, so the most likely first interaction a couple has with the
-- feature -- both tapping "ready" before rating a single item -- returned
-- {"match_count": 0, "mismatch_count": 0} and then locked the reveal for a
-- week. Measured on the hosted project before 20261025000004.
--
-- Creates two fresh users rather than reusing C and D: assertion 29 calls
-- delete_user_account() as user D, and pairings.invitee_user_id references
-- public.profiles(id), so pairing D here fails the foreign key. The A/B
-- fixtures are left alone because they sit exactly at the 3-rating threshold.
reset role;
insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('55555555-5555-5555-5555-555555555555', 'e@yesyas.test', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('66666666-6666-6666-6666-666666666666', 'f@yesyas.test', 'x', now(), now(), now(), 'authenticated', 'authenticated');

do $$
declare
  v_pair uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_items uuid[];
begin
  insert into public.pairings (id, inviter_user_id, invitee_user_id, status)
  values (v_pair, '55555555-5555-5555-5555-555555555555',
                  '66666666-6666-6666-6666-666666666666', 'active');

  select array_agg(id) into v_items
  from (select id from public.desire_library_items order by slug limit 3) x;

  -- E rates two items: below the threshold.
  insert into public.desires (user_id, pairing_id, library_item_id, rating)
  values
    ('55555555-5555-5555-5555-555555555555', v_pair, v_items[1], 5),
    ('55555555-5555-5555-5555-555555555555', v_pair, v_items[2], 5);
  -- F is fully rated, so the failure below is attributable to E alone.
  insert into public.desires (user_id, pairing_id, library_item_id, rating)
  values
    ('66666666-6666-6666-6666-666666666666', v_pair, v_items[1], 5),
    ('66666666-6666-6666-6666-666666666666', v_pair, v_items[2], 5),
    ('66666666-6666-6666-6666-666666666666', v_pair, v_items[3], 5);
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

-- 35. Two ratings is not enough, and it fails with P0002 rather than the
--     cadence code so the client can tell the two apart.
select throws_ok(
  $$ select public.trigger_reveal('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid) $$,
  'P0002',
  null,
  'trigger_reveal refuses a caller with fewer than 3 ratings (P0002, not the cadence P0001)'
);

-- 36. Nothing was written: no readiness row, so no half-consumed state.
select is(
  (select count(*)::int from public.reveal_readiness
    where pairing_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  0,
  'a refused reveal leaves no readiness row behind'
);

reset role;
do $$
declare
  v_pair uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
begin
  insert into public.desires (user_id, pairing_id, library_item_id, rating)
  select '55555555-5555-5555-5555-555555555555', v_pair, id, 5
  from (select id from public.desire_library_items order by slug limit 3) x
  on conflict (user_id, pairing_id, library_item_id) where pairing_id is not null
  do nothing;
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

-- 37. With the third rating in place the same call is allowed through.
select lives_ok(
  $$ select public.trigger_reveal('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid) $$,
  'trigger_reveal proceeds once the caller has 3 ratings'
);

-- ---------- assertions 38-39: library content integrity ----------
--
-- The library is the product's content, and the seed is 736 lines of hand-
-- written tuples ending in `on conflict (slug) do nothing`. That ending is
-- what makes slug hygiene load-bearing rather than cosmetic: a slug that
-- differs from the hosted row by one character inserts a second near-identical
-- item on the next seed run instead of doing nothing. One slug did differ —
-- asking-for-what-I-want, corrected in 20261025000005 — and nothing would have
-- noticed.
--
-- Checked here rather than in the TypeScript verifier because this runs against
-- a database built from the migrations AND the seed, so it tests the seed's
-- actual contents.
reset role;

-- 38. Every slug is lowercase kebab-case.
select is(
  (select count(*)::int from public.desire_library_items
    where slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  0,
  'every library slug is lowercase kebab-case, so the seed cannot double-insert'
);

-- 39. No duplicate titles, and nothing missing the fields the UI renders.
--     A duplicate title is separately ratable and separately matchable, which
--     reads as a bug in the reveal rather than in the content.
select is(
  (
    select count(*)::int
    from public.desire_library_items li
    where li.description is null
       or btrim(li.description) = ''
       or li.tone_tags is null
       or cardinality(li.tone_tags) = 0
       or exists (
            select 1 from unnest(li.tone_tags) t
            where t not in ('romantic', 'playful', 'direct')
          )
       or (select count(*) from public.desire_library_items d
            where lower(d.title) = lower(li.title)) > 1
  ),
  0,
  'every library item has a description and valid tone tags, and no title repeats'
);

-- ---------- assertions 40-42: a partner sees nothing private ----------
--
-- Assertions 1-7 cover desires between A and B. These cover the rest of the
-- per-user tables, because "your partner cannot read your private data" is the
-- product, and a policy widened by accident on any one of these would not fail
-- any existing test.
--
-- The wrapped master key is deliberately NOT re-tested here: assertion 26
-- already covers it, in the same active-pairing framing ("A cannot read an
-- active partner's wrapped key backup"). A first version of this block
-- duplicated it and collided on user_key_recovery_pkey, since user_id is the
-- primary key and the fixture row already existed — CI caught the redundancy
-- before it shipped.
--
-- A and B are an ACTIVE pairing by this point, which is the permissive case —
-- profiles_partner_limited_read only grants across an active pairing, so if
-- any of these leaked, this is where it would show.
reset role;
insert into public.journal_entries (user_id, body)
values ('22222222-2222-2222-2222-222222222222', 'enc:v1:BJOURNALSECRET');
insert into public.ai_flags (user_id, reason)
values ('22222222-2222-2222-2222-222222222222', 'b-private-flag');

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 40. A cannot read B's journal.
select is(
  (select count(*)::int from public.journal_entries
    where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'an active partner cannot read the other partner''s journal entries'
);

-- 41. A cannot read B's AI moderation flags.
select is(
  (select count(*)::int from public.ai_flags
    where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'an active partner cannot read the other partner''s AI flags'
);

-- 42. ai_logs stays closed to clients entirely. RLS is on with no policies,
--     which is deny-all — it is written only by Edge Functions holding the
--     service-role key. Asserted because "no policies" looks like an omission
--     and an obliging future change could add one.
select is(
  (select count(*)::int from public.ai_logs),
  0,
  'ai_logs is not readable by a signed-in client at all'
);

-- ---------- assertions 43-45: desire library clean-up (20261031000001) ----------
reset role;

-- 43. All 23 retired near-duplicates still exist (ratings keep their row)
--     and none is active.
select is(
  (select count(*)::int || '/' || count(*) filter (where active)::int
   from public.desire_library_items
   where slug in ('silent-eye-blink-sync', 'forehead-to-forehead-calm', 'ice-cube-on-collarbones', 'gentle-temple-acupressure', 'gentle-ribcage-hug', 'sensory-contrast-velvet-ice', 'undressing-with-eyes-closed', 'silk-blindfold-kissing', 'whispering-fantasies-at-twilight', 'erotic-compliment-exchange', 'slow-grazing-with-lips', 'warm-lotion-bottle-glide', 'sensual-shower-soap-lather', 'soft-restraint-with-fingers', 'gentle-wrist-pinning-with-kisses', 'edging-with-prolonged-denial', 'exploring-erotic-roleplay-scenario', 'deep-throat-or-slow-suction', 'erotic-blindfold-surprise', 'submissive-surrender-protocol', 'over-the-knee-spanking', 'whispered-explicit-dirty-talk', 'guided-hand-manual-stimulation')),
  '23/0',
  'the 23 retired near-duplicates exist and are all inactive'
);

-- 44. Restraint and hair-pulling are out of the default tier. No active
--     Suggestive item is a wrist hold or hair-pull.
select is(
  (select count(*)::int from public.desire_library_items
   where active
     and tier = 'suggestive'::public.desire_tier
     and slug in ('sensual-hair-pulling', 'soft-restraint-with-fingers',
                  'gentle-wrist-pinning-with-kisses')),
  0,
  'no wrist-hold or hair-pulling item is active in the default Suggestive tier'
);

-- 45. The neck item is gone under its old slug, and its replacement does not
--     name the neck in its title.
select is(
  (select (select count(*) from public.desire_library_items
           where slug = 'breath-play-and-chest-pressure')::int
        + (select count(*) from public.desire_library_items
           where slug = 'gentle-chest-pressure' and title ilike '%neck%')::int),
  0,
  'the breath-play slug is gone and the chest-pressure item does not suggest the neck'
);

select * from finish();
rollback;

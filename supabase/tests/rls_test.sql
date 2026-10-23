-- RLS regression test for YesYas! v1
--
-- Run with: `supabase test db` (requires `supabase start` first).
-- Uses the pgTAP extension that Supabase bundles in its test runner.
--
-- The core invariant: USER A MUST NOT BE ABLE TO READ USER B'S DESIRES.
-- If this test ever fails, halt the release.

begin;
select plan(8);

-- ---------- fixtures ----------
-- Create two auth users directly in auth.users. The on_auth_user_created
-- trigger will create matching profiles rows.
insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'a@yesyas.test', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'b@yesyas.test', 'x', now(), now(), now(), 'authenticated', 'authenticated');

-- Grab a library item to rate.
-- (Seed was applied; pick the first suggestive item.)
do $$
declare
  v_item uuid;
  v_pair uuid;
begin
  select id into v_item from public.desire_library_items where slug = 'written-note-of-appreciation';

  -- Create an active pairing between A and B.
  insert into public.pairings (id, inviter_user_id, invitee_user_id, status)
  values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111',
                             '22222222-2222-2222-2222-222222222222', 'active')
  returning id into v_pair;

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

select is(
  (select count(*)::int from public.desires),
  0,
  'Unauthenticated users see zero desires'
);

select * from finish();
rollback;

-- Migration: 20261101000001_launch_readiness.sql
--
-- Database half of the 1 Nov launch readiness audit.
--
-- 1. Age and terms: profiles.age_confirmed_at and profiles.terms_accepted_at.
--    The app asks for both before onboarding (app/(app)/onboarding/consent.tsx)
--    and before letting an existing account back in. 113 library items are
--    Explicit, and the app stores special category data about sex life, so an
--    18+ confirmation and explicit consent are recorded with a timestamp.
--
-- 2. Size limits. Only desires.match_comment had one, so a direct API call
--    could store an arbitrarily large display name, note or journal entry.
--    note and body are ciphertext (enc:v1:...), so their caps sit well above
--    the plaintext limits the app enforces (2000 and 10000 characters).
--
-- 3. Partner profile leak. RLS is row level, so profiles_partner_limited_read
--    let an active partner read every column of the other's profile, content
--    tier included (verified on the hosted project). The policy goes and a
--    SECURITY DEFINER function returns the partner's display name and nothing
--    else, for active and paused pairings.
--
-- 4. Invite rate limit. create_pairing_invite ends the previous pending invite
--    and inserts a new row on every call, so a loop could grow pairings
--    without bound. Ten invites per user per hour is far above any real use.
--
-- 5. Account deletion also ends PAUSED pairings (it ended only active ones)
--    and removes the user's analytics events and error reports.
--
-- 6. First-party analytics and error reports: analytics_events and
--    client_errors. Write-only for signed-in users (no client can read them,
--    not even their own rows); the operator reads them in the dashboard. No
--    content is ever stored: event names come from a fixed list, and error
--    text is scrubbed of email addresses on the client and capped here.

-- ---------- 1. age and terms ----------
alter table public.profiles
  add column if not exists age_confirmed_at timestamptz,
  add column if not exists terms_accepted_at timestamptz;

comment on column public.profiles.age_confirmed_at is
  'When the user confirmed they are 18 or over. Null means not yet asked.';
comment on column public.profiles.terms_accepted_at is
  'When the user accepted the Terms and Privacy Policy and consented to processing of sensitive data.';

-- ---------- 2. size limits ----------
alter table public.profiles
  add constraint profiles_display_name_length
    check (display_name is null or pg_catalog.char_length(display_name) <= 50);

alter table public.desires
  add constraint desires_note_length
    check (note is null or pg_catalog.char_length(note) <= 12000);

alter table public.journal_entries
  add constraint journal_entries_body_length
    check (pg_catalog.char_length(body) <= 60000);

alter table public.ai_flags
  add constraint ai_flags_reason_length
    check (reason is null or pg_catalog.char_length(reason) <= 500);

-- ---------- 3. partner profile: display name only ----------
drop policy if exists profiles_partner_limited_read on public.profiles;

create or replace function public.get_partner_display_name(p_partner_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.pairings p
    where p.status in ('active'::public.pairing_status, 'paused'::public.pairing_status)
      and (
        (p.inviter_user_id = v_user and p.invitee_user_id = p_partner_id)
        or (p.invitee_user_id = v_user and p.inviter_user_id = p_partner_id)
      )
  ) then
    return null;
  end if;

  select prof.display_name into v_name
  from public.profiles prof
  where prof.id = p_partner_id;

  return v_name;
end;
$$;

revoke all on function public.get_partner_display_name(uuid) from public, anon;
grant execute on function public.get_partner_display_name(uuid) to authenticated;

-- ---------- 4. invite rate limit ----------
create or replace function public.create_pairing_invite()
returns table (pairing_id uuid, invite_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
  v_idx integer;
  v_attempt integer := 0;
  v_pairing_id uuid;
  v_expires_at timestamptz := pg_catalog.now() + interval '48 hours';
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if exists (
    select 1 from public.pairings p
    where p.status = 'active'::public.pairing_status
      and (p.inviter_user_id = v_user or p.invitee_user_id = v_user)
  ) then
    raise exception 'user already has an active pairing' using errcode = '22023';
  end if;

  if (
    select pg_catalog.count(*)
    from public.pairings p
    where p.inviter_user_id = v_user
      and p.created_at > pg_catalog.now() - interval '1 hour'
  ) >= 10 then
    raise exception 'too many invites, try again later' using errcode = 'P0003';
  end if;

  update public.pairings p
  set status = 'ended'::public.pairing_status,
      invite_code = null,
      ended_at = pg_catalog.now()
  where p.inviter_user_id = v_user
    and p.status = 'pending'::public.pairing_status;

  loop
    v_attempt := v_attempt + 1;
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_idx := (pg_catalog.get_byte(v_bytes, i) % 32) + 1;
      v_code := v_code || pg_catalog.substr(v_alphabet, v_idx, 1);
    end loop;

    begin
      insert into public.pairings (
        inviter_user_id, invitee_user_id, status, invite_code, invite_expires_at
      )
      values (v_user, null, 'pending'::public.pairing_status, v_code, v_expires_at)
      returning id into v_pairing_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise exception 'failed to generate unique invite code' using errcode = '22023';
      end if;
    end;
  end loop;

  return query select v_pairing_id as pairing_id, v_code as invite_code, v_expires_at as expires_at;
end;
$$;

revoke all on function public.create_pairing_invite() from public, anon;
grant execute on function public.create_pairing_invite() to authenticated;

-- ---------- 6. first-party analytics and error reports ----------
-- (Created before delete_user_account below, which references them.)
create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event text not null,
  platform text,
  created_at timestamptz not null default now(),
  constraint analytics_events_event_known check (event in (
    'signed_in',
    'consent_given',
    'onboarding_completed',
    'rating_saved',
    'invite_created',
    'pairing_accepted',
    'reveal_ready',
    'reveal_viewed',
    'journal_entry_saved',
    'account_deleted_requested'
  )),
  constraint analytics_events_platform_known check (platform is null or platform in ('ios', 'android', 'web'))
);

create index if not exists analytics_events_event_created on public.analytics_events (event, created_at);
create index if not exists analytics_events_user_id on public.analytics_events (user_id);

alter table public.analytics_events enable row level security;

create policy analytics_events_self_insert on public.analytics_events
  for insert to authenticated
  with check (user_id = (select auth.uid()));
-- No select, update or delete policy: write-only from the app.

create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message text not null,
  stack text,
  route text,
  platform text,
  app_version text,
  created_at timestamptz not null default now(),
  constraint client_errors_message_length check (pg_catalog.char_length(message) between 1 and 500),
  constraint client_errors_stack_length check (stack is null or pg_catalog.char_length(stack) <= 4000),
  constraint client_errors_route_length check (route is null or pg_catalog.char_length(route) <= 200),
  constraint client_errors_platform_known check (platform is null or platform in ('ios', 'android', 'web')),
  constraint client_errors_version_length check (app_version is null or pg_catalog.char_length(app_version) <= 40)
);

create index if not exists client_errors_created on public.client_errors (created_at desc);
create index if not exists client_errors_user_id on public.client_errors (user_id);

alter table public.client_errors enable row level security;

create policy client_errors_self_insert on public.client_errors
  for insert to authenticated
  with check (user_id = (select auth.uid()));
-- No select, update or delete policy: write-only from the app.

-- ---------- 5. account deletion ----------
create or replace function public.delete_user_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  perform pg_catalog.set_config('yesyas.account_deletion', 'true', true);

  -- Paused pairings too: before this only active ones were ended.
  update public.pairings
  set status = 'ended'::public.pairing_status,
      ended_at = pg_catalog.now()
  where (inviter_user_id = v_user or invitee_user_id = v_user)
    and status in ('active'::public.pairing_status, 'paused'::public.pairing_status);

  delete from public.desires where user_id = v_user;
  delete from public.journal_entries where user_id = v_user;
  delete from public.ai_flags where user_id = v_user;
  delete from public.user_key_recovery where user_id = v_user;
  delete from public.reveal_readiness where user_id = v_user;
  delete from public.consent_events where user_id = v_user;
  delete from public.analytics_events where user_id = v_user;
  delete from public.client_errors where user_id = v_user;
  delete from public.profiles where id = v_user;
  delete from auth.users where id = v_user;

  perform pg_catalog.set_config('yesyas.account_deletion', 'false', true);

  return true;
end;
$$;

revoke all on function public.delete_user_account() from public, anon;
grant execute on function public.delete_user_account() to authenticated;

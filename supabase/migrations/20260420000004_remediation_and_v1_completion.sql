-- YesYas! v1 — Security Remediation & v1 Completion Migration
--
-- Remediates the four critical SQL/RLS/reveal vulnerabilities identified in
-- migrations 0001..0003 and completes the v1 database surface:
--   1. Adds profiles.onboarding_complete, pairings.invite_expires_at,
--      and reveals.triggered_by; drops redundant desires_pairing_fk_consistency.
--   2. Enforces at most one open ('pending' | 'both_ready') reveal per pairing
--      via partial unique index reveals_one_open_per_pairing.
--   3. Creates public.ai_flags and public.ai_logs tables with RLS enabled.
--   4. Drops insecure client write policies on pairings and consent_events.
--   5. Hardens all existing SECURITY DEFINER functions with SET search_path = ''
--      and fully schema-qualified references.
--   6. Implements hardened SECURITY DEFINER RPCs for pairing handshake,
--      privacy-preserving reveal computation (Curiosity Bridge, hard veto <= 2),
--      reveal withdrawal, and dual-consent therapist export requests.

-- ---------- 1. Schema additions & constraint cleanup ----------
alter table public.profiles
  add column if not exists onboarding_complete boolean not null default false;

alter table public.pairings
  add column if not exists invite_expires_at timestamptz;

alter table public.reveals
  add column if not exists triggered_by uuid references public.profiles(id) on delete set null;

alter table public.desires
  drop constraint if exists desires_pairing_fk_consistency;

-- ---------- 2. Partial unique index on open reveals ----------
create unique index if not exists reveals_one_open_per_pairing
  on public.reveals (pairing_id)
  where status in ('pending', 'both_ready');

-- ---------- 3. AI Coach safety & logging tables ----------
create table if not exists public.ai_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  reason text not null default 'user_reported',
  created_at timestamptz not null default now()
);

create index if not exists ai_flags_user_created
  on public.ai_flags (user_id, created_at desc);

alter table public.ai_flags enable row level security;

drop policy if exists ai_flags_self_read on public.ai_flags;
create policy ai_flags_self_read
  on public.ai_flags for select
  using (user_id = auth.uid());

drop policy if exists ai_flags_self_insert on public.ai_flags;
create policy ai_flags_self_insert
  on public.ai_flags for insert
  with check (user_id = auth.uid());

create table if not exists public.ai_logs (
  id uuid primary key default gen_random_uuid(),
  user_id_hash text not null,
  thread_id uuid,
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ai_logs_user_hash_created
  on public.ai_logs (user_id_hash, created_at desc);

alter table public.ai_logs enable row level security;
-- No client-side RLS policies on ai_logs: written and read only by Edge Functions using service_role.

-- ---------- 4. Drop insecure client write policies ----------
drop policy if exists pairings_accept_invite on public.pairings;
drop policy if exists pairings_insert_as_inviter on public.pairings;
drop policy if exists pairings_member_update_status on public.pairings;
drop policy if exists consent_self_insert on public.consent_events;

-- ---------- 5. Harden existing functions ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.is_pairing_member(p_pairing_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pairings p
    where p.id = p_pairing_id
      and (p.inviter_user_id = p_user_id or p.invitee_user_id = p_user_id)
  );
$$;

revoke all on function public.is_pairing_member(uuid, uuid) from public;
grant execute on function public.is_pairing_member(uuid, uuid) to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function public.consent_events_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text;
  v_lock_key bigint;
begin
  if new.id is null then
    new.id := extensions.gen_random_uuid();
  end if;

  v_lock_key := pg_catalog.abs(pg_catalog.hashtext(new.user_id::text))::bigint;
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);

  select ce.payload_hash
    into v_prev
  from public.consent_events ce
  where ce.user_id = new.user_id
  order by ce.created_at desc, ce.id desc
  limit 1;

  new.prev_hash := v_prev;
  new.payload_hash := pg_catalog.encode(
    extensions.digest(
      coalesce(new.id::text, '') ||
        '|' || new.event_type::text ||
        '|' || coalesce(new.payload::text, '') ||
        '|' || coalesce(new.prev_hash, ''),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;

create or replace function public.consent_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'consent_events is append-only';
end;
$$;

create or replace function public.expire_old_reveals()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.reveals r
    set status = 'expired'::public.reveal_status,
        summary = pg_catalog.jsonb_build_object(
          'match_count', coalesce(pg_catalog.jsonb_array_length(r.matches), 0),
          'mismatch_count', coalesce(pg_catalog.jsonb_array_length(r.mismatches), 0),
          'expired_at', pg_catalog.now()
        ),
        matches = null,
        mismatches = null
    where r.status = 'computed'::public.reveal_status
      and r.expires_at < pg_catalog.now()
    returning 1
  )
  select count(*)::integer into v_count from expired;
  return v_count;
end;
$$;

revoke all on function public.expire_old_reveals() from public;
grant execute on function public.expire_old_reveals() to authenticated;

-- ---------- 6. Hardened SECURITY DEFINER RPCs ----------

-- 6.1 create_pairing_invite()
create or replace function public.create_pairing_invite()
returns table (
  pairing_id uuid,
  invite_code text,
  expires_at timestamptz
)
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
    select 1
    from public.pairings p
    where p.status = 'active'::public.pairing_status
      and (p.inviter_user_id = v_user or p.invitee_user_id = v_user)
  ) then
    raise exception 'user already has an active pairing' using errcode = '22023';
  end if;

  -- Cancel any prior unclaimed pending invites created by this inviter.
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
        inviter_user_id,
        invitee_user_id,
        status,
        invite_code,
        invite_expires_at
      )
      values (
        v_user,
        null,
        'pending'::public.pairing_status,
        v_code,
        v_expires_at
      )
      returning id into v_pairing_id;

      exit;
    exception
      when unique_violation then
        if v_attempt >= 10 then
          raise exception 'failed to generate unique invite code' using errcode = '22023';
        end if;
    end;
  end loop;

  return query
    select
      v_pairing_id as pairing_id,
      v_code as invite_code,
      v_expires_at as expires_at;
end;
$$;

revoke all on function public.create_pairing_invite() from public;
grant execute on function public.create_pairing_invite() to authenticated;

-- 6.2 preview_pairing_invite(p_invite_code text)
create or replace function public.preview_pairing_invite(p_invite_code text)
returns table (
  pairing_id uuid,
  inviter_display_name text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_norm_code text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_invite_code, '')));
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if v_norm_code = '' then
    raise exception 'invite code is required' using errcode = '22023';
  end if;

  return query
    select
      p.id as pairing_id,
      coalesce(nullif(pg_catalog.btrim(prof.display_name), ''), 'Your partner') as inviter_display_name,
      coalesce(p.invite_expires_at, p.created_at + interval '48 hours') as expires_at
    from public.pairings p
    join public.profiles prof on prof.id = p.inviter_user_id
    where p.invite_code = v_norm_code
      and p.status = 'pending'::public.pairing_status
      and p.invitee_user_id is null
      and (p.invite_expires_at is null or p.invite_expires_at > pg_catalog.now())
    limit 1;
end;
$$;

revoke all on function public.preview_pairing_invite(text) from public;
grant execute on function public.preview_pairing_invite(text) to authenticated;

-- 6.3 accept_pairing_invite(p_invite_code text)
create or replace function public.accept_pairing_invite(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_norm_code text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_invite_code, '')));
  v_pairing_id uuid;
  v_inviter uuid;
  v_expires_at timestamptz;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if v_norm_code = '' then
    raise exception 'invalid or expired invite code' using errcode = '22023';
  end if;

  select p.id, p.inviter_user_id, p.invite_expires_at
    into v_pairing_id, v_inviter, v_expires_at
  from public.pairings p
  where p.invite_code = v_norm_code
    and p.status = 'pending'::public.pairing_status
    and p.invitee_user_id is null
  for update;

  if v_pairing_id is null then
    raise exception 'invalid or expired invite code' using errcode = '22023';
  end if;

  if v_expires_at is not null and v_expires_at <= pg_catalog.now() then
    raise exception 'invite code has expired' using errcode = '22023';
  end if;

  if v_inviter = v_user then
    raise exception 'inviter cannot accept own invite' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.pairings p
    where p.status = 'active'::public.pairing_status
      and (
        p.inviter_user_id in (v_user, v_inviter)
        or p.invitee_user_id in (v_user, v_inviter)
      )
  ) then
    raise exception 'one of the users already has an active pairing' using errcode = '22023';
  end if;

  update public.pairings p
  set invitee_user_id = v_user,
      status = 'active'::public.pairing_status,
      invite_code = null
  where p.id = v_pairing_id;

  -- Graduate solo desires (pairing_id IS NULL) for both inviter and invitee
  -- into the newly active pairing without overwriting any existing paired rows.
  insert into public.desires (user_id, pairing_id, library_item_id, rating, note)
  select
    d.user_id,
    v_pairing_id,
    d.library_item_id,
    d.rating,
    d.note
  from public.desires d
  where d.user_id in (v_inviter, v_user)
    and d.pairing_id is null
  on conflict (user_id, pairing_id, library_item_id) where pairing_id is not null
  do nothing;

  -- Write pairing_accepted consent events for both members.
  insert into public.consent_events (user_id, pairing_id, event_type, payload)
  values
    (v_inviter, v_pairing_id, 'pairing_accepted'::public.consent_event_type, pg_catalog.jsonb_build_object('role', 'inviter')),
    (v_user, v_pairing_id, 'pairing_accepted'::public.consent_event_type, pg_catalog.jsonb_build_object('role', 'invitee'));

  return v_pairing_id;
end;
$$;

revoke all on function public.accept_pairing_invite(text) from public;
grant execute on function public.accept_pairing_invite(text) to authenticated;

-- 6.4 update_pairing_status(p_pairing_id uuid, p_new_status public.pairing_status)
create or replace function public.update_pairing_status(
  p_pairing_id uuid,
  p_new_status public.pairing_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_inviter uuid;
  v_invitee uuid;
  v_current_status public.pairing_status;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select p.inviter_user_id, p.invitee_user_id, p.status
    into v_inviter, v_invitee, v_current_status
  from public.pairings p
  where p.id = p_pairing_id
  for update;

  if v_current_status is null or (v_inviter <> v_user and coalesce(v_invitee, '00000000-0000-0000-0000-000000000000'::uuid) <> v_user) then
    raise exception 'not a member of this pairing' using errcode = '42501';
  end if;

  if p_new_status not in ('active'::public.pairing_status, 'paused'::public.pairing_status, 'ended'::public.pairing_status) then
    raise exception 'invalid target pairing status' using errcode = '22023';
  end if;

  if v_current_status = 'ended'::public.pairing_status then
    raise exception 'cannot transition an ended pairing' using errcode = '22023';
  end if;

  if v_current_status = 'pending'::public.pairing_status and p_new_status <> 'ended'::public.pairing_status then
    raise exception 'pending pairing can only be cancelled (ended) via update_pairing_status' using errcode = '22023';
  end if;

  update public.pairings p
  set status = p_new_status,
      invite_code = case when p_new_status = 'ended'::public.pairing_status then null else p.invite_code end,
      ended_at = case when p_new_status = 'ended'::public.pairing_status then pg_catalog.now() else p.ended_at end
  where p.id = p_pairing_id;

  if p_new_status = 'ended'::public.pairing_status then
    insert into public.consent_events (user_id, pairing_id, event_type, payload)
    values (
      v_user,
      p_pairing_id,
      'pairing_ended'::public.consent_event_type,
      pg_catalog.jsonb_build_object('ended_by', v_user)
    );

    if v_invitee is not null and v_invitee <> v_user then
      insert into public.consent_events (user_id, pairing_id, event_type, payload)
      values (
        v_invitee,
        p_pairing_id,
        'pairing_ended'::public.consent_event_type,
        pg_catalog.jsonb_build_object('ended_by', v_user)
      );
    elsif v_inviter <> v_user then
      insert into public.consent_events (user_id, pairing_id, event_type, payload)
      values (
        v_inviter,
        p_pairing_id,
        'pairing_ended'::public.consent_event_type,
        pg_catalog.jsonb_build_object('ended_by', v_user)
      );
    end if;
  end if;
end;
$$;

revoke all on function public.update_pairing_status(uuid, public.pairing_status) from public;
grant execute on function public.update_pairing_status(uuid, public.pairing_status) to authenticated;

-- 6.5 trigger_reveal(p_pairing_id uuid)
create or replace function public.trigger_reveal(p_pairing_id uuid)
returns table (
  reveal_id uuid,
  status public.reveal_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_other uuid;
  v_window_id uuid;
  v_partner_ready timestamptz;
  v_caller_already_ready boolean := false;
  v_reveal_id uuid;
  v_matches jsonb;
  v_mismatches jsonb;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- Verify caller is a member of an active pairing (table-qualify p.status!).
  select
    case
      when p.inviter_user_id = v_user then p.invitee_user_id
      when p.invitee_user_id = v_user then p.inviter_user_id
    end
    into v_other
  from public.pairings p
  where p.id = p_pairing_id
    and p.status = 'active'::public.pairing_status;

  if v_other is null then
    raise exception 'not a member of an active pairing' using errcode = '42501';
  end if;

  -- Check if the partner has an active readiness entry within the 72-hour window.
  select rr.reveal_window_id, rr.ready_at
    into v_window_id, v_partner_ready
  from public.reveal_readiness rr
  where rr.pairing_id = p_pairing_id
    and rr.user_id = v_other
    and rr.ready_at > pg_catalog.now() - interval '72 hours'
  order by rr.ready_at desc
  limit 1;

  -- If partner is not ready yet, check if caller already has an active readiness window.
  if v_window_id is null then
    select rr.reveal_window_id, true
      into v_window_id, v_caller_already_ready
    from public.reveal_readiness rr
    where rr.pairing_id = p_pairing_id
      and rr.user_id = v_user
      and rr.ready_at > pg_catalog.now() - interval '72 hours'
    order by rr.ready_at desc
    limit 1;
  end if;

  if v_window_id is null then
    v_window_id := extensions.gen_random_uuid();
  end if;

  -- Record caller readiness in this window (idempotent).
  insert into public.reveal_readiness (pairing_id, user_id, reveal_window_id)
  values (p_pairing_id, v_user, v_window_id)
  on conflict (pairing_id, user_id, reveal_window_id) do nothing;

  -- Both partners ready? Compute the double-blind intersection and Curiosity Bridge.
  if v_partner_ready is not null then
    with
      a as (
        select d.library_item_id, d.rating
        from public.desires d
        where d.user_id = v_user
          and d.pairing_id = p_pairing_id
      ),
      b as (
        select d.library_item_id, d.rating
        from public.desires d
        where d.user_id = v_other
          and d.pairing_id = p_pairing_id
      ),
      joined as (
        select
          li.id as library_item_id,
          li.slug,
          li.title,
          li.description,
          li.tier,
          a.rating as a_rating,
          b.rating as b_rating
        from a
        inner join b on b.library_item_id = a.library_item_id
        inner join public.desire_library_items li on li.id = a.library_item_id
        -- Hard veto on <= 2: any item rated 1 or 2 by either partner is strictly excluded.
        where a.rating > 2
          and b.rating > 2
      )
    select
      coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'library_item_id', j.library_item_id,
            'slug', j.slug,
            'title', j.title,
            'description', j.description,
            'tier', j.tier
          )
          order by j.slug
        ) filter (where j.a_rating >= 4 and j.b_rating >= 4),
        '[]'::jsonb
      ),
      coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'library_item_id', j.library_item_id,
            'slug', j.slug,
            'title', j.title,
            'tier', j.tier
          )
          order by j.slug
        ) filter (
          where (j.a_rating >= 4 and j.b_rating = 3)
             or (j.a_rating = 3 and j.b_rating >= 4)
        ),
        '[]'::jsonb
      )
      into v_matches, v_mismatches
    from joined j;

    -- Look up the existing open ('pending' or 'both_ready') reveal row for this pairing.
    select r.id
      into v_reveal_id
    from public.reveals r
    where r.pairing_id = p_pairing_id
      and r.status in ('pending'::public.reveal_status, 'both_ready'::public.reveal_status)
    order by r.triggered_at desc
    limit 1
    for update;

    if v_reveal_id is not null then
      update public.reveals r
      set status = 'computed'::public.reveal_status,
          both_ready_at = pg_catalog.now(),
          revealed_at = pg_catalog.now(),
          expires_at = pg_catalog.now() + interval '24 hours',
          matches = v_matches,
          mismatches = v_mismatches,
          summary = pg_catalog.jsonb_build_object(
            'match_count', coalesce(pg_catalog.jsonb_array_length(v_matches), 0),
            'mismatch_count', coalesce(pg_catalog.jsonb_array_length(v_mismatches), 0)
          )
      where r.id = v_reveal_id;
    else
      insert into public.reveals (
        pairing_id,
        status,
        triggered_by,
        both_ready_at,
        revealed_at,
        expires_at,
        matches,
        mismatches,
        summary
      )
      values (
        p_pairing_id,
        'computed'::public.reveal_status,
        v_user,
        pg_catalog.now(),
        pg_catalog.now(),
        pg_catalog.now() + interval '24 hours',
        v_matches,
        v_mismatches,
        pg_catalog.jsonb_build_object(
          'match_count', coalesce(pg_catalog.jsonb_array_length(v_matches), 0),
          'mismatch_count', coalesce(pg_catalog.jsonb_array_length(v_mismatches), 0)
        )
      )
      returning id into v_reveal_id;
    end if;

    -- Consume readiness rows for this pairing so subsequent reveals start fresh.
    delete from public.reveal_readiness rr
    where rr.pairing_id = p_pairing_id;

    -- Log reveal_triggered for Partner 2 and reveal_revealed for both partners.
    insert into public.consent_events (user_id, pairing_id, event_type, payload)
    values
      (v_user, p_pairing_id, 'reveal_triggered'::public.consent_event_type, pg_catalog.jsonb_build_object('window_id', v_window_id)),
      (v_user, p_pairing_id, 'reveal_revealed'::public.consent_event_type, pg_catalog.jsonb_build_object('reveal_id', v_reveal_id)),
      (v_other, p_pairing_id, 'reveal_revealed'::public.consent_event_type, pg_catalog.jsonb_build_object('reveal_id', v_reveal_id));

    return query
      select
        v_reveal_id as reveal_id,
        'computed'::public.reveal_status as status;
  else
    -- Partner is not ready yet: ensure exactly one 'pending' reveal row exists.
    insert into public.reveals (pairing_id, status, triggered_by)
    values (p_pairing_id, 'pending'::public.reveal_status, v_user)
    on conflict (pairing_id) where status in ('pending'::public.reveal_status, 'both_ready'::public.reveal_status)
    do nothing
    returning id into v_reveal_id;

    if v_reveal_id is null then
      select r.id
        into v_reveal_id
      from public.reveals r
      where r.pairing_id = p_pairing_id
        and r.status in ('pending'::public.reveal_status, 'both_ready'::public.reveal_status)
      order by r.triggered_at desc
      limit 1;
    end if;

    -- Only append reveal_triggered when caller first marks ready in this window.
    if not v_caller_already_ready then
      insert into public.consent_events (user_id, pairing_id, event_type, payload)
      values (
        v_user,
        p_pairing_id,
        'reveal_triggered'::public.consent_event_type,
        pg_catalog.jsonb_build_object('window_id', v_window_id, 'reveal_id', v_reveal_id)
      );
    end if;

    return query
      select
        v_reveal_id as reveal_id,
        'pending'::public.reveal_status as status;
  end if;
end;
$$;

revoke all on function public.trigger_reveal(uuid) from public;
grant execute on function public.trigger_reveal(uuid) to authenticated;

-- 6.6 withdraw_reveal(p_pairing_id uuid)
create or replace function public.withdraw_reveal(p_pairing_id uuid)
returns void
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

  if not public.is_pairing_member(p_pairing_id, v_user) then
    raise exception 'not a member of this pairing' using errcode = '42501';
  end if;

  delete from public.reveal_readiness rr
  where rr.pairing_id = p_pairing_id
    and rr.user_id = v_user;

  delete from public.reveals r
  where r.pairing_id = p_pairing_id
    and r.status = 'pending'::public.reveal_status
    and (r.triggered_by = v_user or r.triggered_by is null);
end;
$$;

revoke all on function public.withdraw_reveal(uuid) from public;
grant execute on function public.withdraw_reveal(uuid) to authenticated;

-- 6.7 request_therapist_export(p_pairing_id uuid)
create or replace function public.request_therapist_export(p_pairing_id uuid)
returns table (
  both_consented boolean,
  export_event_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_other uuid;
  v_event_id uuid;
  v_partner_consented boolean := false;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select
    case
      when p.inviter_user_id = v_user then p.invitee_user_id
      when p.invitee_user_id = v_user then p.inviter_user_id
    end
    into v_other
  from public.pairings p
  where p.id = p_pairing_id
    and p.status in ('active'::public.pairing_status, 'paused'::public.pairing_status);

  if v_other is null then
    raise exception 'not a member of an active or paused pairing' using errcode = '42501';
  end if;

  insert into public.consent_events (user_id, pairing_id, event_type, payload)
  values (
    v_user,
    p_pairing_id,
    'therapist_export'::public.consent_event_type,
    pg_catalog.jsonb_build_object('action', 'consent_granted')
  )
  returning id into v_event_id;

  select exists (
    select 1
    from public.consent_events ce
    where ce.user_id = v_other
      and ce.pairing_id = p_pairing_id
      and ce.event_type = 'therapist_export'::public.consent_event_type
      and ce.created_at > pg_catalog.now() - interval '7 days'
  )
  into v_partner_consented;

  return query
    select
      v_partner_consented as both_consented,
      v_event_id as export_event_id;
end;
$$;

revoke all on function public.request_therapist_export(uuid) from public;
grant execute on function public.request_therapist_export(uuid) to authenticated;

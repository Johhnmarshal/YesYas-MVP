-- Migration: 20261023000002_account_deletion_and_cadence.sql
--
-- Implements:
--   1. R-02: Real Account Deletion (UK GDPR erasure).
--      Allows controlled cascade of append-only consent_events during account erasure,
--      and introduces SECURITY DEFINER RPC delete_user_account() that purges:
--      - desires
--      - journal_entries
--      - ai_flags
--      - user_key_recovery
--      - reveal_readiness
--      - consent_events
--      - profiles
--      - auth.users
--      and dissolves any active pairings.
--
--   2. R-03: Reveal Cadence Enforcement.
--      Enforces the PRD rule that couples can only compute a double-blind reveal
--      once per 7 days on the standard cadence, preventing pressure churn.

-- 1. Update consent_events_immutable() to honor the account deletion session flag.
create or replace function public.consent_events_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('yesyas.account_deletion', true) = 'true' then
    return old;
  end if;
  raise exception 'consent_events is append-only';
end;
$$;

-- 2. Define the delete_user_account() RPC.
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

  -- Set transaction-local flag so consent_events trigger permits cascade/erasure.
  perform pg_catalog.set_config('yesyas.account_deletion', 'true', true);

  -- 1. End any active pairings the user belongs to.
  update public.pairings
  set status = 'ended'::public.pairing_status,
      ended_at = pg_catalog.now()
  where (inviter_user_id = v_user or invitee_user_id = v_user)
    and status = 'active'::public.pairing_status;

  -- 2. Delete desires.
  delete from public.desires where user_id = v_user;

  -- 3. Delete journal entries.
  delete from public.journal_entries where user_id = v_user;

  -- 4. Delete AI flags.
  delete from public.ai_flags where user_id = v_user;

  -- 5. Delete user key recovery backup.
  delete from public.user_key_recovery where user_id = v_user;

  -- 6. Delete reveal readiness records.
  delete from public.reveal_readiness where user_id = v_user;

  -- 7. Delete consent events (now permitted via yesyas.account_deletion).
  delete from public.consent_events where user_id = v_user;

  -- 8. Delete user profile.
  delete from public.profiles where id = v_user;

  -- 9. Delete user from auth.users (UK GDPR erasure).
  delete from auth.users where id = v_user;

  return true;
end;
$$;

revoke all on function public.delete_user_account() from public;
grant execute on function public.delete_user_account() to authenticated;

comment on function public.delete_user_account() is
  'Performs UK GDPR erasure for the authenticated user, deleting credentials, profile, encrypted data, key backup, and consent logs.';

-- 3. Update trigger_reveal() to enforce the 7-day reveal cadence (R-03).
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
  v_last_revealed_at timestamptz;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- Verify caller is a member of an active pairing.
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

  -- Enforce 7-day cadence (R-03): Check if this pairing already had a reveal computed within 7 days.
  select r.revealed_at
    into v_last_revealed_at
  from public.reveals r
  where r.pairing_id = p_pairing_id
    and r.status = 'computed'::public.reveal_status
    and r.revealed_at > pg_catalog.now() - interval '7 days'
  order by r.revealed_at desc
  limit 1;

  if v_last_revealed_at is not null then
    raise exception 'Reveal cadence limit: you can only reveal once every 7 days on the standard cadence' using errcode = 'P0001';
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

  -- Both partners ready? Compute double-blind intersection and Curiosity Bridge.
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

    -- Look up existing open reveal row for this pairing.
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

    -- Log consent events for both partners.
    insert into public.consent_events (user_id, pairing_id, event_type, payload)
    values
      (v_user, p_pairing_id, 'reveal_triggered', pg_catalog.jsonb_build_object('reveal_id', v_reveal_id, 'role', 'caller')),
      (v_other, p_pairing_id, 'reveal_triggered', pg_catalog.jsonb_build_object('reveal_id', v_reveal_id, 'role', 'partner'));

    return query
    select v_reveal_id, 'computed'::public.reveal_status;
    return;
  end if;

  -- Partner is not ready yet: insert or retain pending reveal.
  select r.id
    into v_reveal_id
  from public.reveals r
  where r.pairing_id = p_pairing_id
    and r.status = 'pending'::public.reveal_status
  order by r.triggered_at desc
  limit 1;

  if v_reveal_id is null then
    insert into public.reveals (
      pairing_id,
      status,
      triggered_by,
      summary
    )
    values (
      p_pairing_id,
      'pending'::public.reveal_status,
      v_user,
      '{"match_count": 0, "mismatch_count": 0}'::jsonb
    )
    returning id into v_reveal_id;

    insert into public.consent_events (user_id, pairing_id, event_type, payload)
    values (v_user, p_pairing_id, 'reveal_triggered', pg_catalog.jsonb_build_object('reveal_id', v_reveal_id, 'state', 'waiting_for_partner'));
  end if;

  return query
  select v_reveal_id, 'pending'::public.reveal_status;
end;
$$;

revoke all on function public.trigger_reveal(uuid) from public;
grant execute on function public.trigger_reveal(uuid) to authenticated;

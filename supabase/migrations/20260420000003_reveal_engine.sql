-- YesYas! v1 — reveal engine RPC
--
-- `trigger_reveal(p_pairing_id)` is the single entry point callable by a
-- paired user when they're ready to reveal. It:
--   1. Verifies the caller is a member of the pairing.
--   2. Marks the user as ready.
--   3. If both are ready and within the 72-hour window, computes the
--      intersection (both rated >= 4) and mismatches (one >= 4 and other <= 2)
--      server-side, writes a reveal row, and returns its id.
--   4. Otherwise returns the current reveal row in 'pending' status.
--
-- The function runs as SECURITY DEFINER so it can read both users' desires
-- (which RLS would otherwise block). All state changes happen inside one
-- transaction.

-- For v1 we track "ready" with a small helper table rather than adding
-- columns to reveals. Easier to extend later (e.g., per-tier readiness).
create table public.reveal_readiness (
  pairing_id uuid not null references public.pairings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ready_at timestamptz not null default now(),
  reveal_window_id uuid not null default gen_random_uuid(),
  primary key (pairing_id, user_id, reveal_window_id)
);

create index reveal_readiness_window
  on public.reveal_readiness (pairing_id, reveal_window_id, ready_at);

alter table public.reveal_readiness enable row level security;

create policy reveal_readiness_member_read
  on public.reveal_readiness for select
  using (public.is_pairing_member(pairing_id, auth.uid()));

-- Clients cannot insert directly; must go through trigger_reveal.
-- (No insert policy means no client-side insert is allowed.)

create or replace function public.trigger_reveal(p_pairing_id uuid)
returns table (reveal_id uuid, status reveal_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_other uuid;
  v_window_id uuid;
  v_partner_ready timestamptz;
  v_reveal_id uuid;
  v_matches jsonb;
  v_mismatches jsonb;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- Find the other party. Errors if the caller is not a member.
  select case
           when inviter_user_id = v_user then invitee_user_id
           when invitee_user_id = v_user then inviter_user_id
         end
    into v_other
  from public.pairings
  where id = p_pairing_id and status = 'active';

  if v_other is null then
    raise exception 'not a member of an active pairing' using errcode = '42501';
  end if;

  -- Find or open the current reveal window. A window stays open for 72h
  -- after the first user marks themselves ready.
  select reveal_window_id, ready_at
    into v_window_id, v_partner_ready
  from public.reveal_readiness
  where pairing_id = p_pairing_id
    and user_id = v_other
    and ready_at > now() - interval '72 hours'
  order by ready_at desc
  limit 1;

  if v_window_id is null then
    v_window_id := gen_random_uuid();
  end if;

  -- Mark caller ready in this window (idempotent).
  insert into public.reveal_readiness (pairing_id, user_id, reveal_window_id)
  values (p_pairing_id, v_user, v_window_id)
  on conflict do nothing;

  -- Both ready? Compute the reveal.
  if v_partner_ready is not null then
    with
      a as (
        select library_item_id, rating
        from public.desires
        where user_id = v_user and pairing_id = p_pairing_id
      ),
      b as (
        select library_item_id, rating
        from public.desires
        where user_id = v_other and pairing_id = p_pairing_id
      ),
      joined as (
        select a.library_item_id, a.rating as a_rating, b.rating as b_rating
        from a inner join b using (library_item_id)
      )
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object('library_item_id', library_item_id,
                             'a_rating', a_rating,
                             'b_rating', b_rating)
        ) filter (where a_rating >= 4 and b_rating >= 4),
        '[]'::jsonb
      ),
      coalesce(
        jsonb_agg(
          jsonb_build_object('library_item_id', library_item_id,
                             'a_rating', a_rating,
                             'b_rating', b_rating)
        ) filter (where (a_rating >= 4 and b_rating <= 2)
                     or (a_rating <= 2 and b_rating >= 4)),
        '[]'::jsonb
      )
      into v_matches, v_mismatches
    from joined;

    insert into public.reveals (pairing_id, status, both_ready_at, revealed_at, expires_at, matches, mismatches)
    values (p_pairing_id, 'computed', now(), now(), now() + interval '24 hours', v_matches, v_mismatches)
    returning id into v_reveal_id;

    -- Write consent events for both parties (audit chain).
    insert into public.consent_events (user_id, pairing_id, event_type, payload)
    values
      (v_user, p_pairing_id, 'reveal_revealed', jsonb_build_object('reveal_id', v_reveal_id)),
      (v_other, p_pairing_id, 'reveal_revealed', jsonb_build_object('reveal_id', v_reveal_id));

    return query select v_reveal_id, 'computed'::reveal_status;
  else
    -- Not both ready yet. Ensure there's a pending reveal row so the UI
    -- can show "waiting for partner."
    insert into public.reveals (pairing_id, status)
    values (p_pairing_id, 'pending')
    on conflict do nothing
    returning id into v_reveal_id;

    if v_reveal_id is null then
      select id into v_reveal_id
      from public.reveals
      where pairing_id = p_pairing_id and status = 'pending'
      order by triggered_at desc
      limit 1;
    end if;

    insert into public.consent_events (user_id, pairing_id, event_type, payload)
    values (v_user, p_pairing_id, 'reveal_triggered', jsonb_build_object('window_id', v_window_id));

    return query select v_reveal_id, 'pending'::reveal_status;
  end if;
end;
$$;

-- Let authenticated users call this; SECURITY DEFINER still limits the
-- data it can actually touch to the pairing's two members.
grant execute on function public.trigger_reveal(uuid) to authenticated;

-- Expiry sweeper: a cron-able function that moves expired reveals from
-- 'computed' to 'expired' and purges the match/mismatch detail, leaving
-- only a counts summary.
create or replace function public.expire_old_reveals()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.reveals
    set status = 'expired',
        summary = jsonb_build_object(
          'match_count', coalesce(jsonb_array_length(matches), 0),
          'mismatch_count', coalesce(jsonb_array_length(mismatches), 0),
          'expired_at', now()
        ),
        matches = null,
        mismatches = null
    where status = 'computed'
      and expires_at < now()
    returning 1
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;

-- Schedule this from Supabase's pg_cron (outside this migration) after enabling:
--   select cron.schedule('expire-reveals', '*/15 * * * *', 'select public.expire_old_reveals()');

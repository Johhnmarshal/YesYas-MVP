-- Migration: 20261111000001_nudges_and_progress.sql
--
-- "It feels obligatory", "there is no feel of we are doing something".
-- Two small things that make a partner feel present without revealing any
-- answer:
--
-- 1. A one-tap "thinking of you" nudge. The partner sees it on Home for a
--    day and, if they have emails on, gets a discreet email.
-- 2. A shared progress number: how much of the library the two of you have
--    both explored. It is a single count of items you have BOTH rated, with
--    no ratings and no tiers, so it says you are doing this together without
--    saying what either of you chose.

-- ---------- 1. nudges ----------
alter table public.notification_outbox
  drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in ('partner_ready', 'matches_ready', 'nudge'));

create table if not exists public.partner_nudges (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  pairing_id uuid not null references public.pairings(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now()
);

create index if not exists partner_nudges_recipient_idx
  on public.partner_nudges (recipient_id, created_at desc);
create index if not exists partner_nudges_sender_idx
  on public.partner_nudges (sender_id, created_at desc);
create index if not exists partner_nudges_pairing_idx
  on public.partner_nudges (pairing_id);

alter table public.partner_nudges enable row level security;
revoke all on table public.partner_nudges from anon, authenticated;
grant select on table public.partner_nudges to authenticated;

-- You can see nudges sent to you and the ones you sent; nobody writes rows
-- directly (send_nudge does, with its checks).
drop policy if exists partner_nudges_read_own on public.partner_nudges;
create policy partner_nudges_read_own on public.partner_nudges
  for select to authenticated
  using (recipient_id = (select auth.uid()) or sender_id = (select auth.uid()));

create or replace function public.send_nudge(p_pairing_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_other uuid;
  v_now timestamptz := pg_catalog.now();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select case
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

  -- A nudge is a small gesture, not a stream: one every six hours.
  if exists (
    select 1 from public.partner_nudges n
    where n.sender_id = v_user
      and n.pairing_id = p_pairing_id
      and n.created_at > v_now - interval '6 hours'
  ) then
    raise exception 'nudge already sent recently' using errcode = 'P0004';
  end if;

  insert into public.partner_nudges (pairing_id, sender_id, recipient_id)
  values (p_pairing_id, v_user, v_other);

  perform public.enqueue_notification(v_other, p_pairing_id, 'nudge');
  return v_now;
end;
$$;

revoke all on function public.send_nudge(uuid) from public, anon;
grant execute on function public.send_nudge(uuid) to authenticated;

-- ---------- 2. shared progress ----------
-- Items both partners have rated (any rating), out of the active items both
-- can see (up to the lower of the two heat limits). Returns counts only.
create or replace function public.get_shared_progress(p_pairing_id uuid)
returns table(explored_together integer, total integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_other uuid;
  v_my_tier public.desire_tier;
  v_their_tier public.desire_tier;
  v_ceiling integer;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select case
           when p.inviter_user_id = v_user then p.invitee_user_id
           when p.invitee_user_id = v_user then p.inviter_user_id
         end
    into v_other
  from public.pairings p
  where p.id = p_pairing_id
    and p.status in ('active'::public.pairing_status, 'paused'::public.pairing_status);

  if v_other is null then
    raise exception 'not a member of this pairing' using errcode = '42501';
  end if;

  select pr.content_tier_preference into v_my_tier from public.profiles pr where pr.id = v_user;
  select pr.content_tier_preference into v_their_tier from public.profiles pr where pr.id = v_other;

  -- sensory < suggestive < explicit; the shared ceiling is the lower one.
  v_ceiling := least(
    case coalesce(v_my_tier::text, 'suggestive') when 'sensory' then 1 when 'suggestive' then 2 else 3 end,
    case coalesce(v_their_tier::text, 'suggestive') when 'sensory' then 1 when 'suggestive' then 2 else 3 end
  );

  return query
  with visible as (
    select li.id
    from public.desire_library_items li
    where li.active
      and (case li.tier::text when 'sensory' then 1 when 'suggestive' then 2 else 3 end) <= v_ceiling
  )
  select
    (
      select pg_catalog.count(*)::integer
      from visible v
      where exists (select 1 from public.desires d where d.user_id = v_user and d.pairing_id = p_pairing_id and d.library_item_id = v.id)
        and exists (select 1 from public.desires d where d.user_id = v_other and d.pairing_id = p_pairing_id and d.library_item_id = v.id)
    ),
    (select pg_catalog.count(*)::integer from visible);
end;
$$;

revoke all on function public.get_shared_progress(uuid) from public, anon;
grant execute on function public.get_shared_progress(uuid) to authenticated;

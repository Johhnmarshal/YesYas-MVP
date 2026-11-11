-- Migration: 20261113000001_presence.sql
--
-- "Is my partner even using this?" Three opt-in ways to feel the other
-- person is there. Every one is off by default and costs nothing to leave
-- off.
--
-- 1. share_presence: while you have the app open, your partner can see that
--    you are here (and whether you are in the library). It works both ways
--    or not at all: you only see your partner if you share too, and the
--    Realtime channel itself refuses anyone who has not opted in.
-- 2. share_heat: your partner sees your heat limit (sensory, suggestive or
--    explicit), so they know where you are comfortable exploring. Never your
--    ratings.
-- 3. avatar: an emoji your partner sees next to your name.

alter table public.profiles
  add column if not exists share_presence boolean not null default false,
  add column if not exists share_heat boolean not null default false,
  add column if not exists avatar text
    check (avatar is null or pg_catalog.char_length(avatar) between 1 and 16);

-- What a partner may know about you. Nothing is returned for anyone you are
-- not paired with (active or paused).
create or replace function public.get_partner_profile(p_partner_id uuid)
returns table(display_name text, avatar text, heat text, shares_presence boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.pairings p
    where p.status in ('active'::public.pairing_status, 'paused'::public.pairing_status)
      and ((p.inviter_user_id = v_user and p.invitee_user_id = p_partner_id)
        or (p.invitee_user_id = v_user and p.inviter_user_id = p_partner_id))
  ) then
    return;
  end if;
  return query
  select prof.display_name,
         prof.avatar,
         case when prof.share_heat then prof.content_tier_preference::text end,
         prof.share_presence
  from public.profiles prof
  where prof.id = p_partner_id;
end;
$$;
revoke all on function public.get_partner_profile(uuid) from public, anon;
grant execute on function public.get_partner_profile(uuid) to authenticated;

-- True when the caller may use the presence channel for this topic: the
-- topic is 'pairing:<id>' of an active pairing they belong to, and BOTH
-- partners have share_presence on.
create or replace function public.can_use_pairing_presence(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pairings p
    join public.profiles me on me.id = (select auth.uid())
    join public.profiles them
      on them.id = case when p.inviter_user_id = (select auth.uid())
                        then p.invitee_user_id else p.inviter_user_id end
    where 'pairing:' || p.id::text = p_topic
      and p.status = 'active'::public.pairing_status
      and (select auth.uid()) in (p.inviter_user_id, p.invitee_user_id)
      and me.share_presence
      and them.share_presence
  )
$$;
revoke all on function public.can_use_pairing_presence(text) from public, anon;
grant execute on function public.can_use_pairing_presence(text) to authenticated;

-- Realtime Authorization for private channels
-- (https://supabase.com/docs/guides/realtime/authorization): presence
-- messages on a pairing topic, for its two members, only when both opted in.
-- Guarded so the migration also runs where the realtime schema is absent.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists pairing_presence_read on realtime.messages';
    execute $p$
      create policy pairing_presence_read on realtime.messages
        for select to authenticated
        using (
          realtime.messages.extension in ('presence')
          and public.can_use_pairing_presence((select realtime.topic()))
        )
    $p$;
    execute 'drop policy if exists pairing_presence_write on realtime.messages';
    execute $p$
      create policy pairing_presence_write on realtime.messages
        for insert to authenticated
        with check (
          realtime.messages.extension in ('presence')
          and public.can_use_pairing_presence((select realtime.topic()))
        )
    $p$;
  end if;
end;
$$;

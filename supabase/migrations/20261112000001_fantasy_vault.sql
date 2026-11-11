-- Migration: 20261112000001_fantasy_vault.sql
--
-- Fantasy Vault. Testers wanted a way to say something specific, in their
-- own words, without the risk of saying it out loud first.
--
-- 1. public.fantasies: your own private fantasies. The body is encrypted on
--    the device exactly like journal_entries.body, so the server only ever
--    holds ciphertext, and only you can read or write your rows.
-- 2. public.fantasy_cards: one fantasy you chose to send to your partner.
--    The partner has to be able to read it, so this copy is plain text on
--    the server, readable only through the functions below. The app says so
--    before you send. Your partner knows it came from you.
--    The partner rates it 1 to 5. Only a yes (4 or 5) ever goes back to the
--    author; a lower answer stays with the person who gave it.
--    The partner can report a card, which hides it from them and keeps it for
--    review. The author is never told: a withdrawn card disappears for them
--    either way, but a reported one is kept rather than deleted.

-- ---------- 1. private fantasies ----------
create table if not exists public.fantasies (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (pg_catalog.char_length(body) <= 12000),
  created_at timestamptz not null default pg_catalog.now()
);
create index if not exists fantasies_user_created on public.fantasies (user_id, created_at desc);

alter table public.fantasies enable row level security;
revoke all on table public.fantasies from anon;
grant select, insert, update, delete on table public.fantasies to authenticated;

drop policy if exists fantasies_self_read on public.fantasies;
create policy fantasies_self_read on public.fantasies
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists fantasies_self_insert on public.fantasies;
create policy fantasies_self_insert on public.fantasies
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists fantasies_self_update on public.fantasies;
create policy fantasies_self_update on public.fantasies
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists fantasies_self_delete on public.fantasies;
create policy fantasies_self_delete on public.fantasies
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------- 2. shared cards ----------
create table if not exists public.fantasy_cards (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  pairing_id uuid not null references public.pairings(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (pg_catalog.char_length(pg_catalog.btrim(body)) between 1 and 600),
  created_at timestamptz not null default pg_catalog.now(),
  response smallint check (response between 1 and 5),
  responded_at timestamptz,
  reported_at timestamptz,
  report_reason text check (report_reason is null or pg_catalog.char_length(report_reason) <= 280),
  -- Set when the author withdraws a card that had been reported: it leaves
  -- their list like any withdrawn card, but the row is kept for review.
  withdrawn_at timestamptz
);
create index if not exists fantasy_cards_pairing_created on public.fantasy_cards (pairing_id, created_at desc);
create index if not exists fantasy_cards_author on public.fantasy_cards (author_id, created_at desc);
create index if not exists fantasy_cards_recipient on public.fantasy_cards (recipient_id);

-- No direct access at all: the response column must never reach the author
-- unless it is a yes, and RLS cannot hide a column. Everything goes through
-- the functions below.
alter table public.fantasy_cards enable row level security;
revoke all on table public.fantasy_cards from anon, authenticated;

alter table public.notification_outbox
  drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in ('partner_ready', 'matches_ready', 'nudge', 'fantasy'));

-- Partner in an active pairing, or null.
create or replace function public.active_partner_of(p_pairing_id uuid, p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when p.inviter_user_id = p_user then p.invitee_user_id
           when p.invitee_user_id = p_user then p.inviter_user_id
         end
  from public.pairings p
  where p.id = p_pairing_id
    and p.status = 'active'::public.pairing_status
$$;
revoke all on function public.active_partner_of(uuid, uuid) from public, anon, authenticated;

create or replace function public.send_fantasy_card(p_pairing_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_other uuid;
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  v_other := public.active_partner_of(p_pairing_id, v_user);
  if v_other is null then
    raise exception 'not a member of an active pairing' using errcode = '42501';
  end if;
  if pg_catalog.char_length(v_body) < 1 or pg_catalog.char_length(v_body) > 600 then
    raise exception 'a card is 1 to 600 characters' using errcode = '22023';
  end if;
  -- Three a day keeps it special and limits any one-sided flood.
  if (
    select pg_catalog.count(*) from public.fantasy_cards c
    where c.author_id = v_user and c.created_at > pg_catalog.now() - interval '24 hours'
  ) >= 3 then
    raise exception 'card limit reached for today' using errcode = 'P0004';
  end if;

  insert into public.fantasy_cards (pairing_id, author_id, recipient_id, body)
  values (p_pairing_id, v_user, v_other, v_body)
  returning id into v_id;

  perform public.enqueue_notification(v_other, p_pairing_id, 'fantasy');
  return v_id;
end;
$$;
revoke all on function public.send_fantasy_card(uuid, text) from public, anon;
grant execute on function public.send_fantasy_card(uuid, text) to authenticated;

-- Cards in this pairing, from the caller's side.
--   sent:     your card; is_yes says whether your partner said yes. Their
--             answer is otherwise never returned, nor whether they reported it.
--   received: your partner's card and your own answer. Reported cards are
--             hidden from you.
create or replace function public.list_fantasy_cards(p_pairing_id uuid)
returns table(
  id uuid,
  direction text,
  body text,
  created_at timestamptz,
  my_response smallint,
  is_yes boolean
)
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
    where p.id = p_pairing_id
      and p.status in ('active'::public.pairing_status, 'paused'::public.pairing_status)
      and v_user in (p.inviter_user_id, p.invitee_user_id)
  ) then
    raise exception 'not a member of this pairing' using errcode = '42501';
  end if;

  return query
  select c.id,
         case when c.author_id = v_user then 'sent' else 'received' end,
         c.body,
         c.created_at,
         case when c.recipient_id = v_user then c.response end,
         (c.reported_at is null and c.response >= 4)
  from public.fantasy_cards c
  where c.pairing_id = p_pairing_id
    and ((c.author_id = v_user and c.withdrawn_at is null)
         or (c.recipient_id = v_user and c.reported_at is null))
  order by c.created_at desc
  limit 100;
end;
$$;
revoke all on function public.list_fantasy_cards(uuid) from public, anon;
grant execute on function public.list_fantasy_cards(uuid) to authenticated;

create or replace function public.answer_fantasy_card(p_card_id uuid, p_rating smallint)
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
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be 1 to 5' using errcode = '22023';
  end if;
  update public.fantasy_cards c
     set response = p_rating, responded_at = pg_catalog.now()
   where c.id = p_card_id
     and c.recipient_id = v_user
     and c.reported_at is null;
  if not found then
    raise exception 'card not found' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.answer_fantasy_card(uuid, smallint) from public, anon;
grant execute on function public.answer_fantasy_card(uuid, smallint) to authenticated;

create or replace function public.report_fantasy_card(p_card_id uuid, p_reason text)
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
  update public.fantasy_cards c
     set reported_at = pg_catalog.now(),
         report_reason = pg_catalog.left(nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''), 280),
         response = null,
         responded_at = null
   where c.id = p_card_id
     and c.recipient_id = v_user
     and c.reported_at is null;
  if not found then
    raise exception 'card not found' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.report_fantasy_card(uuid, text) from public, anon;
grant execute on function public.report_fantasy_card(uuid, text) to authenticated;

-- The author can take a card back. A reported card is kept for review, but
-- withdrawing it looks exactly the same to the author.
create or replace function public.withdraw_fantasy_card(p_card_id uuid)
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
  delete from public.fantasy_cards c
   where c.id = p_card_id
     and c.author_id = v_user
     and c.reported_at is null;
  if not found then
    update public.fantasy_cards c
       set withdrawn_at = pg_catalog.now()
     where c.id = p_card_id
       and c.author_id = v_user
       and c.withdrawn_at is null;
    if not found then
      raise exception 'card not found' using errcode = '42501';
    end if;
  end if;
end;
$$;
revoke all on function public.withdraw_fantasy_card(uuid) from public, anon;
grant execute on function public.withdraw_fantasy_card(uuid) to authenticated;

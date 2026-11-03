-- Migration: 20261103000001_reveal_notifications.sql
--
-- Close the reveal loop.
--
-- Until now nothing told a partner that the other had tapped "I'm ready". The
-- only nudge was a message copied to the clipboard. On the hosted project the
-- one reveal ever started sat in `pending` because the second partner never
-- learned it was waiting, so the product's payoff (seeing what you both want)
-- had never been delivered.
--
-- This adds a small outbox. The database decides WHAT to tell someone and
-- WHEN, inside the same transaction as the readiness or reveal change; the
-- `notify` Edge Function only delivers what is queued. Keeping the decision
-- here means it cannot drift from the reveal rules and is covered by pgTAP.
--
-- Privacy: the outbox stores who and which kind of nudge, never anything about
-- desires, ratings or matches. Emails say only that a partner is ready or that
-- something is waiting. Each person can switch emails off in Settings.

-- ---------- 1. preference ----------
alter table public.profiles
  add column if not exists email_notifications boolean not null default true;

comment on column public.profiles.email_notifications is
  'Whether to send discreet emails when a partner is ready or a reveal is waiting.';

-- ---------- 2. outbox ----------
create table if not exists public.notification_outbox (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  pairing_id uuid references public.pairings(id) on delete cascade,
  kind text not null check (kind in ('partner_ready', 'matches_ready')),
  created_at timestamptz not null default pg_catalog.now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 500)
);

-- RLS on with no policies: only the service role (the Edge Function) touches
-- it. Clients can neither read who is being nudged nor queue mail themselves.
alter table public.notification_outbox enable row level security;
revoke all on table public.notification_outbox from anon, authenticated;

create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (pairing_id)
  where sent_at is null;
create index if not exists notification_outbox_recipient_idx
  on public.notification_outbox (recipient_id);

-- ---------- 3. enqueue ----------
create or replace function public.enqueue_notification(
  p_recipient uuid,
  p_pairing uuid,
  p_kind text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient is null then
    return;
  end if;

  -- Respect the opt-out.
  if not exists (
    select 1 from public.profiles pr
    where pr.id = p_recipient and pr.email_notifications
  ) then
    return;
  end if;

  -- At most one of each kind per person per pairing every 12 hours, so
  -- tapping ready, withdrawing and tapping again does not become a stream
  -- of mail.
  if exists (
    select 1 from public.notification_outbox o
    where o.recipient_id = p_recipient
      and o.pairing_id is not distinct from p_pairing
      and o.kind = p_kind
      and o.created_at > pg_catalog.now() - interval '12 hours'
  ) then
    return;
  end if;

  insert into public.notification_outbox (recipient_id, pairing_id, kind)
  values (p_recipient, p_pairing, p_kind);
end;
$$;

revoke all on function public.enqueue_notification(uuid, uuid, text)
  from public, anon, authenticated;

-- ---------- 4. partner became ready ----------
create or replace function public.notify_on_readiness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other uuid;
begin
  select case
           when p.inviter_user_id = new.user_id then p.invitee_user_id
           else p.inviter_user_id
         end
    into v_other
  from public.pairings p
  where p.id = new.pairing_id
    and p.status = 'active'::public.pairing_status;

  if v_other is null then
    return new;
  end if;

  -- If the other partner is already ready, this tap completes the reveal and
  -- the matches_ready nudge (below) is the one that matters.
  if exists (
    select 1 from public.reveal_readiness rr
    where rr.pairing_id = new.pairing_id
      and rr.user_id = v_other
      and rr.ready_at > pg_catalog.now() - interval '72 hours'
  ) then
    return new;
  end if;

  perform public.enqueue_notification(v_other, new.pairing_id, 'partner_ready');
  return new;
end;
$$;

revoke all on function public.notify_on_readiness() from public, anon, authenticated;

drop trigger if exists reveal_readiness_notify on public.reveal_readiness;
create trigger reveal_readiness_notify
  after insert on public.reveal_readiness
  for each row execute function public.notify_on_readiness();

-- Withdrawing readiness (or the reveal completing, or an account being
-- deleted) removes the row; a "your partner is ready" email that has not gone
-- out yet would now be untrue, so drop it.
create or replace function public.cancel_ready_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notification_outbox o
  where o.pairing_id = old.pairing_id
    and o.kind = 'partner_ready'
    and o.sent_at is null
    and o.recipient_id <> old.user_id;
  return old;
end;
$$;

revoke all on function public.cancel_ready_notification() from public, anon, authenticated;

drop trigger if exists reveal_readiness_cancel_notify on public.reveal_readiness;
create trigger reveal_readiness_cancel_notify
  after delete on public.reveal_readiness
  for each row execute function public.cancel_ready_notification();

-- ---------- 5. reveal computed ----------
-- The partner who completes the reveal sees it on screen; the one who tapped
-- ready earlier may be anywhere, so they get the nudge.
create or replace function public.notify_on_reveal_computed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inviter uuid;
  v_invitee uuid;
  v_caller uuid := auth.uid();
begin
  if new.status <> 'computed'::public.reveal_status then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'computed'::public.reveal_status then
    return new;
  end if;

  select p.inviter_user_id, p.invitee_user_id
    into v_inviter, v_invitee
  from public.pairings p
  where p.id = new.pairing_id;

  if v_inviter is not null and v_inviter is distinct from v_caller then
    perform public.enqueue_notification(v_inviter, new.pairing_id, 'matches_ready');
  end if;
  if v_invitee is not null and v_invitee is distinct from v_caller then
    perform public.enqueue_notification(v_invitee, new.pairing_id, 'matches_ready');
  end if;
  return new;
end;
$$;

revoke all on function public.notify_on_reveal_computed() from public, anon, authenticated;

drop trigger if exists reveals_notify_computed on public.reveals;
create trigger reveals_notify_computed
  after insert or update of status on public.reveals
  for each row execute function public.notify_on_reveal_computed();

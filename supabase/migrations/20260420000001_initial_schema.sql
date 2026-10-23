-- YesYas! v1 — initial schema
-- Seven tables. Everything else is derivable.

create extension if not exists pgcrypto;

-- ---------- enums ----------
create type tone_label as enum ('romantic', 'playful', 'direct');
create type desire_tier as enum ('sensory', 'suggestive', 'explicit');
create type pairing_status as enum ('pending', 'active', 'paused', 'ended');
create type reveal_status as enum ('pending', 'both_ready', 'computed', 'expired');
create type consent_event_type as enum (
  'pairing_accepted',
  'pairing_ended',
  'reveal_triggered',
  'reveal_revealed',
  'therapist_export'
);

-- ---------- profiles ----------
-- 1:1 with auth.users. We don't store email here — auth.users already has it.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  tone_preference tone_label not null default 'romantic',
  content_tier_preference desire_tier not null default 'suggestive',
  locale text not null default 'en-US',
  created_at timestamptz not null default now()
);

-- Keep profiles in sync with auth.users on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- pairings ----------
-- An exclusive one-to-one relationship. At most one 'active' pairing per user.
create table public.pairings (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references public.profiles(id) on delete cascade,
  invitee_user_id uuid references public.profiles(id) on delete cascade,
  status pairing_status not null default 'pending',
  invite_code text unique,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint inviter_invitee_differ
    check (invitee_user_id is null or invitee_user_id <> inviter_user_id)
);

-- One ACTIVE pairing per user on either side. Partial unique indexes.
create unique index pairings_one_active_inviter
  on public.pairings (inviter_user_id)
  where status = 'active';

create unique index pairings_one_active_invitee
  on public.pairings (invitee_user_id)
  where status = 'active';

create index pairings_inviter_status on public.pairings (inviter_user_id, status);
create index pairings_invitee_status on public.pairings (invitee_user_id, status);

-- Helper: is a given user a party to a given pairing?
create or replace function public.is_pairing_member(p_pairing_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.pairings p
    where p.id = p_pairing_id
      and (p.inviter_user_id = p_user_id or p.invitee_user_id = p_user_id)
  );
$$;

-- ---------- desire library ----------
create table public.desire_library_items (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  description text,
  tier desire_tier not null,
  tone_tags text[] not null default '{}',
  locale text not null default 'en-US',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index desire_library_active_tier on public.desire_library_items (active, tier);

-- ---------- desires ----------
-- A user's rating of a library item. pairing_id null = solo mode.
create table public.desires (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  pairing_id uuid references public.pairings(id) on delete cascade,
  library_item_id uuid not null references public.desire_library_items(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Enforce one rating per (user, pairing-or-solo, item).
  -- Since UNIQUE treats NULLs as distinct, we need two partial unique indexes.
  constraint desires_pairing_fk_consistency check (
    pairing_id is null or pairing_id is not null
  )
);

create unique index desires_unique_paired
  on public.desires (user_id, pairing_id, library_item_id)
  where pairing_id is not null;

create unique index desires_unique_solo
  on public.desires (user_id, library_item_id)
  where pairing_id is null;

create index desires_pairing_user on public.desires (pairing_id, user_id) where pairing_id is not null;

-- Keep updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger desires_touch_updated_at
  before update on public.desires
  for each row execute function public.touch_updated_at();

-- ---------- reveals ----------
create table public.reveals (
  id uuid primary key default gen_random_uuid(),
  pairing_id uuid not null references public.pairings(id) on delete cascade,
  status reveal_status not null default 'pending',
  triggered_at timestamptz not null default now(),
  both_ready_at timestamptz,
  revealed_at timestamptz,
  expires_at timestamptz,
  matches jsonb,
  mismatches jsonb,
  summary jsonb
);

create index reveals_pairing_status on public.reveals (pairing_id, status);

-- ---------- journal entries (solo) ----------
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  ai_coach_thread_id uuid,
  created_at timestamptz not null default now()
);

create index journal_user_created on public.journal_entries (user_id, created_at desc);

-- ---------- consent audit ----------
-- Append-only. Hash-chained per user so any tampering is detectable.
create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  pairing_id uuid references public.pairings(id) on delete set null,
  event_type consent_event_type not null,
  payload jsonb,
  payload_hash text not null,
  prev_hash text,
  created_at timestamptz not null default now()
);

create index consent_events_user_chain
  on public.consent_events (user_id, created_at, id);

-- Hash-chain trigger: on insert, look up the most recent event for this user,
-- set prev_hash, and compute payload_hash over (id, event_type, payload, prev_hash).
-- Serialized per user via a transaction-scoped advisory lock.
create or replace function public.consent_events_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev text;
  v_lock_key bigint;
begin
  -- Hash the uuid text to a bigint for the advisory lock.
  v_lock_key := abs(hashtext(new.user_id::text))::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select payload_hash
    into v_prev
  from public.consent_events
  where user_id = new.user_id
  order by created_at desc, id desc
  limit 1;

  new.prev_hash := v_prev;
  new.payload_hash := encode(
    digest(
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

create trigger consent_events_chain_trigger
  before insert on public.consent_events
  for each row execute function public.consent_events_chain();

-- Append-only enforcement: block update + delete at the SQL layer. RLS will
-- also block both, but defense in depth is cheap here.
create or replace function public.consent_events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'consent_events is append-only';
end;
$$;

create trigger consent_events_no_update
  before update on public.consent_events
  for each row execute function public.consent_events_immutable();

create trigger consent_events_no_delete
  before delete on public.consent_events
  for each row execute function public.consent_events_immutable();

comment on table public.consent_events is
  'Append-only, hash-chained per user. Do not modify existing rows.';

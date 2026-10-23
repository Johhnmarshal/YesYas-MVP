-- YesYas! — recovery-code backup for the client-side encryption key
--
-- Before this migration the per-user master key lived only in AsyncStorage on
-- the device that created it. A reinstall, a cleared app, or a sign-in on a
-- second device minted a *new* key, which left every existing
-- `desires.note` and `journal_entries.body` permanently undecryptable.
--
-- This table holds that master key wrapped under a key-encryption key derived
-- from a recovery code that only the user ever sees (PBKDF2-HMAC-SHA256, then
-- the same encrypt-then-MAC envelope used for note bodies). The server stores
-- the wrapped blob and the KDF parameters; it never sees the recovery code or
-- the master key, so it still cannot read any user content.

create table if not exists public.user_key_recovery (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  -- `enc:v1:<iv>:<ciphertext>:<mac>` envelope over the 32-byte master key.
  wrapped_key text not null,
  -- Hex salt fed to PBKDF2 alongside the recovery code.
  salt text not null,
  iterations integer not null,
  kdf text not null default 'pbkdf2-hmac-sha256',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_key_recovery_wrapped_key_envelope
    check (wrapped_key like 'enc:v1:%'),
  constraint user_key_recovery_salt_hex
    check (salt ~ '^[0-9a-f]{32,128}$'),
  constraint user_key_recovery_iterations_floor
    check (iterations >= 100000)
);

comment on table public.user_key_recovery is
  'Master encryption key wrapped under a user-held recovery code. Opaque to the server.';

alter table public.user_key_recovery enable row level security;

-- Self-only on every verb. A partner must never learn whether a backup exists,
-- let alone read the blob, so there is deliberately no partner-read policy here
-- (unlike public.profiles).
drop policy if exists user_key_recovery_self_read on public.user_key_recovery;
create policy user_key_recovery_self_read
  on public.user_key_recovery for select
  using (user_id = auth.uid());

drop policy if exists user_key_recovery_self_insert on public.user_key_recovery;
create policy user_key_recovery_self_insert
  on public.user_key_recovery for insert
  with check (user_id = auth.uid());

-- Replacing a recovery code overwrites the row in place.
drop policy if exists user_key_recovery_self_update on public.user_key_recovery;
create policy user_key_recovery_self_update
  on public.user_key_recovery for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_key_recovery_self_delete on public.user_key_recovery;
create policy user_key_recovery_self_delete
  on public.user_key_recovery for delete
  using (user_id = auth.uid());

drop trigger if exists user_key_recovery_touch_updated_at on public.user_key_recovery;
create trigger user_key_recovery_touch_updated_at
  before update on public.user_key_recovery
  for each row execute function public.touch_updated_at();

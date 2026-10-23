-- YesYas! v1 — Row-Level Security policies
--
-- Every public table has RLS enabled. No "server knows better" logic bypasses
-- RLS. Edge Functions that need elevated access use the service_role key
-- explicitly and are few in number (reveal engine + consent writer).

-- ---------- profiles ----------
alter table public.profiles enable row level security;

create policy profiles_self_read
  on public.profiles for select
  using (id = auth.uid());

create policy profiles_partner_limited_read
  on public.profiles for select
  using (
    exists (
      select 1 from public.pairings p
      where p.status = 'active'
        and ((p.inviter_user_id = auth.uid() and p.invitee_user_id = profiles.id)
          or (p.invitee_user_id = auth.uid() and p.inviter_user_id = profiles.id))
    )
  );

create policy profiles_self_update
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- profiles_insert is handled by the on_auth_user_created trigger. Block
-- direct inserts from clients.
create policy profiles_no_client_insert
  on public.profiles for insert
  with check (false);

-- ---------- pairings ----------
alter table public.pairings enable row level security;

create policy pairings_member_read
  on public.pairings for select
  using (
    inviter_user_id = auth.uid()
    or invitee_user_id = auth.uid()
  );

-- Anyone can create a pairing, but only as the inviter.
create policy pairings_insert_as_inviter
  on public.pairings for insert
  with check (
    inviter_user_id = auth.uid()
    and status in ('pending')
    and invitee_user_id is null
  );

-- Accepting an invite: an authenticated user claims a pending pairing by its
-- invite_code, becoming the invitee. We can't easily scope by invite_code in
-- the USING clause without leaking pending rows, so we only allow the update
-- if the row is still pending with no invitee, and the new invitee is auth.uid().
create policy pairings_accept_invite
  on public.pairings for update
  using (
    status = 'pending'
    and invitee_user_id is null
  )
  with check (
    status in ('active', 'pending')
    and (invitee_user_id = auth.uid() or invitee_user_id is null)
  );

create policy pairings_member_update_status
  on public.pairings for update
  using (
    status in ('active', 'paused')
    and (inviter_user_id = auth.uid() or invitee_user_id = auth.uid())
  )
  with check (
    (inviter_user_id = auth.uid() or invitee_user_id = auth.uid())
    and status in ('active', 'paused', 'ended')
  );

-- No DELETE policy. Pairings are ended, not deleted.

-- ---------- desire_library_items ----------
alter table public.desire_library_items enable row level security;

create policy desire_library_public_read
  on public.desire_library_items for select
  using (active = true);

-- No insert/update/delete from client. Managed via migrations + seed.

-- ---------- desires ----------
alter table public.desires enable row level security;

-- Critical invariant: a user can only read THEIR OWN desires, never their
-- partner's. The reveal engine uses service_role to read both sides and
-- writes only the intersection into the reveals table.
create policy desires_self_read
  on public.desires for select
  using (user_id = auth.uid());

create policy desires_self_write
  on public.desires for insert
  with check (
    user_id = auth.uid()
    and (
      pairing_id is null
      or public.is_pairing_member(pairing_id, auth.uid())
    )
  );

create policy desires_self_update
  on public.desires for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      pairing_id is null
      or public.is_pairing_member(pairing_id, auth.uid())
    )
  );

create policy desires_self_delete
  on public.desires for delete
  using (user_id = auth.uid());

-- ---------- reveals ----------
alter table public.reveals enable row level security;

-- Both members of the pairing can read reveal rows (which contain only
-- mutually-matched items — never the raw desires).
create policy reveals_member_read
  on public.reveals for select
  using (public.is_pairing_member(reveals.pairing_id, auth.uid()));

-- Clients cannot write to reveals. Only the reveal engine (Edge Function
-- using service_role) inserts/updates. No policies for insert/update/delete.

-- ---------- journal_entries ----------
alter table public.journal_entries enable row level security;

create policy journal_self_read
  on public.journal_entries for select
  using (user_id = auth.uid());

create policy journal_self_write
  on public.journal_entries for insert
  with check (user_id = auth.uid());

create policy journal_self_update
  on public.journal_entries for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy journal_self_delete
  on public.journal_entries for delete
  using (user_id = auth.uid());

-- ---------- consent_events ----------
alter table public.consent_events enable row level security;

-- Users can read their own audit chain. No updates, no deletes — the triggers
-- already raise, but RLS reinforces it.
create policy consent_self_read
  on public.consent_events for select
  using (user_id = auth.uid());

create policy consent_self_insert
  on public.consent_events for insert
  with check (user_id = auth.uid());

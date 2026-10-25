-- Migration: 20261025000002_rls_initplan_and_fk_indexes.sql
--
-- Two findings from Supabase's performance linter against the live project.
--
-- 1. auth_rls_initplan, 21 policies.
--
--    `auth.uid()` written bare in a policy is re-evaluated for every row the
--    policy is checked against. Wrapping it as `(select auth.uid())` makes
--    Postgres treat it as an InitPlan: evaluated once per statement, then
--    reused. The semantics are identical — it is the same function returning
--    the same value for the duration of a statement — so this is purely about
--    how often it runs.
--
--    It matters here more than the generic advice suggests. desires is the
--    hot table: a paired user accumulates a row per library item, and the
--    library is now 180 items. Every read of their ratings evaluates the
--    policy per row, so this is 180 function calls where one will do, on the
--    screen users spend the most time in.
--
--    Every policy below is a faithful rewrite of what was already live — only
--    the auth.uid() calls are parenthesised. The RLS suite is the check that
--    nothing shifted: supabase/tests/rls_test.sql covers the core invariant
--    that user A cannot read user B's desires, and it runs in CI.
--
-- 2. unindexed_foreign_keys, 5 constraints.
--
--    A foreign key with no covering index makes the referenced side's deletes
--    and updates scan. delete_user_account() cascades across most of these,
--    so UK GDPR erasure is exactly the path that pays for it.

-- ---------- profiles ----------
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read
  on public.profiles for select
  using (id = (select auth.uid()));

drop policy if exists profiles_partner_limited_read on public.profiles;
create policy profiles_partner_limited_read
  on public.profiles for select
  using (
    exists (
      select 1 from public.pairings p
      where p.status = 'active'::public.pairing_status
        and ((p.inviter_user_id = (select auth.uid()) and p.invitee_user_id = profiles.id)
          or (p.invitee_user_id = (select auth.uid()) and p.inviter_user_id = profiles.id))
    )
  );

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update
  on public.profiles for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------- pairings ----------
drop policy if exists pairings_member_read on public.pairings;
create policy pairings_member_read
  on public.pairings for select
  using (
    inviter_user_id = (select auth.uid())
    or invitee_user_id = (select auth.uid())
  );

-- ---------- desires (the hot table) ----------
drop policy if exists desires_self_read on public.desires;
create policy desires_self_read
  on public.desires for select
  using (user_id = (select auth.uid()));

drop policy if exists desires_self_write on public.desires;
create policy desires_self_write
  on public.desires for insert
  with check (
    user_id = (select auth.uid())
    and (pairing_id is null or public.is_pairing_member(pairing_id, (select auth.uid())))
  );

drop policy if exists desires_self_update on public.desires;
create policy desires_self_update
  on public.desires for update
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (pairing_id is null or public.is_pairing_member(pairing_id, (select auth.uid())))
  );

drop policy if exists desires_self_delete on public.desires;
create policy desires_self_delete
  on public.desires for delete
  using (user_id = (select auth.uid()));

-- ---------- journal_entries ----------
drop policy if exists journal_self_read on public.journal_entries;
create policy journal_self_read
  on public.journal_entries for select
  using (user_id = (select auth.uid()));

drop policy if exists journal_self_write on public.journal_entries;
create policy journal_self_write
  on public.journal_entries for insert
  with check (user_id = (select auth.uid()));

drop policy if exists journal_self_update on public.journal_entries;
create policy journal_self_update
  on public.journal_entries for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists journal_self_delete on public.journal_entries;
create policy journal_self_delete
  on public.journal_entries for delete
  using (user_id = (select auth.uid()));

-- ---------- reveals / reveal_readiness ----------
drop policy if exists reveals_member_read on public.reveals;
create policy reveals_member_read
  on public.reveals for select
  using (public.is_pairing_member(pairing_id, (select auth.uid())));

drop policy if exists reveal_readiness_member_read on public.reveal_readiness;
create policy reveal_readiness_member_read
  on public.reveal_readiness for select
  using (public.is_pairing_member(pairing_id, (select auth.uid())));

-- ---------- consent_events ----------
drop policy if exists consent_self_read on public.consent_events;
create policy consent_self_read
  on public.consent_events for select
  using (user_id = (select auth.uid()));

-- ---------- ai_flags ----------
drop policy if exists ai_flags_self_read on public.ai_flags;
create policy ai_flags_self_read
  on public.ai_flags for select
  using (user_id = (select auth.uid()));

drop policy if exists ai_flags_self_insert on public.ai_flags;
create policy ai_flags_self_insert
  on public.ai_flags for insert
  with check (user_id = (select auth.uid()));

-- ---------- user_key_recovery ----------
drop policy if exists user_key_recovery_self_read on public.user_key_recovery;
create policy user_key_recovery_self_read
  on public.user_key_recovery for select
  using (user_id = (select auth.uid()));

drop policy if exists user_key_recovery_self_insert on public.user_key_recovery;
create policy user_key_recovery_self_insert
  on public.user_key_recovery for insert
  with check (user_id = (select auth.uid()));

drop policy if exists user_key_recovery_self_update on public.user_key_recovery;
create policy user_key_recovery_self_update
  on public.user_key_recovery for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_key_recovery_self_delete on public.user_key_recovery;
create policy user_key_recovery_self_delete
  on public.user_key_recovery for delete
  using (user_id = (select auth.uid()));

-- ---------- Covering indexes for foreign keys ----------
create index if not exists ai_flags_journal_entry_id_idx
  on public.ai_flags (journal_entry_id);

create index if not exists consent_events_pairing_id_idx
  on public.consent_events (pairing_id);

create index if not exists desires_library_item_id_idx
  on public.desires (library_item_id);

create index if not exists reveal_readiness_user_id_idx
  on public.reveal_readiness (user_id);

create index if not exists reveals_triggered_by_idx
  on public.reveals (triggered_by);

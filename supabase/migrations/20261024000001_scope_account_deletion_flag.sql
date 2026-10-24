-- Migration: 20261024000001_scope_account_deletion_flag.sql
--
-- Narrows the window in which public.consent_events can be deleted.
--
-- 20261023000002 made the append-only guarantee on consent_events conditional:
-- consent_events_immutable() permits the delete whenever the transaction-local
-- setting `yesyas.account_deletion` is 'true', which delete_user_account() sets
-- so UK GDPR erasure can purge the caller's audit trail.
--
-- That function never cleared the flag. set_config(..., is_local => true) scopes
-- it to the transaction, and PostgREST gives each request its own transaction,
-- so production was contained — but anything that calls this function inside a
-- larger transaction (another SECURITY DEFINER routine, a batch job, or the
-- pgTAP suite, which runs the whole file in one transaction) left every
-- subsequent statement in that transaction able to delete consent rows.
--
-- The function body is otherwise unchanged from 20261023000002.

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

  -- 10. Close the window. Erasure is done, so nothing later in this
  --      transaction should be able to delete consent rows. A raise above this
  --      line aborts the transaction and discards the flag with it, so the
  --      success path is the only one that needs clearing.
  perform pg_catalog.set_config('yesyas.account_deletion', 'false', true);

  return true;
end;
$$;

revoke all on function public.delete_user_account() from public;
grant execute on function public.delete_user_account() to authenticated;

comment on function public.delete_user_account() is
  'Performs UK GDPR erasure for the authenticated user, deleting credentials, profile, encrypted data, key backup, and consent logs. Clears the yesyas.account_deletion flag before returning so consent_events is append-only again for the rest of the transaction.';

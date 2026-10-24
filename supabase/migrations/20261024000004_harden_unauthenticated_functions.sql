-- Migration: 20261024000004_harden_unauthenticated_functions.sql
--
-- Defence in depth for the two functions that 20261024000003 protects purely
-- with GRANTs.
--
-- That migration revokes EXECUTE from `anon`, which is correct and necessary.
-- But relying on grants alone is fragile here: Supabase's ALTER DEFAULT
-- PRIVILEGES re-grants EXECUTE to `anon` on every new function in `public`,
-- a later `create or replace` can quietly reset privileges, and the whole
-- class of bug only shows up in a linter run. Every other SECURITY DEFINER
-- function in this schema opens with an `auth.uid() is null` check and is
-- therefore safe even if its grants are wrong. These two did not.
--
--   * is_pairing_member(uuid, uuid) answered "is this user in this pairing?"
--     for any pair of UUIDs, with no reference to the caller. Now it only
--     answers about the caller's own membership, which is all its single
--     caller (withdraw_reveal, which passes auth.uid()) ever needed. Any other
--     question now returns false rather than leaking.
--
--   * expire_old_reveals() had no caller check at all and writes across every
--     pairing. It now requires an authenticated JWT.
--
--     Two earlier attempts at a role-based escape hatch for pg_cron both
--     failed in CI, and the reason is worth recording. Inside a SECURITY
--     DEFINER function `current_user` is the function OWNER, not the caller,
--     so `current_user not in ('postgres', ...)` can never be true and the
--     guard never fires. `session_user` is no better: PostgREST connects as
--     `authenticator` and then SET ROLEs to anon or authenticated, so every
--     API call — signed in or not — shares one session_user.
--
--     auth.uid() is the only reliable discriminator: anon carries no JWT sub,
--     authenticated does. The cost is that a pg_cron job, which has no JWT,
--     can no longer call this. Nothing schedules it today (see
--     docs/BETA_READINESS.md), and when something does it should run the
--     UPDATE directly or use a separate function granted only to the
--     scheduler, rather than widening this one back out.

create or replace function public.is_pairing_member(p_pairing_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pairings p
    where p.id = p_pairing_id
      and (p.inviter_user_id = p_user_id or p.invitee_user_id = p_user_id)
      -- Only ever answers about the caller. Without this the function is an
      -- unauthenticated membership oracle for anyone holding two UUIDs.
      and p_user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_pairing_member(uuid, uuid) from public, anon;
grant execute on function public.is_pairing_member(uuid, uuid) to authenticated;

create or replace function public.expire_old_reveals()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Signed-in callers only. See the header for why current_user and
  -- session_user cannot be used to make this decision.
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  with expired as (
    update public.reveals r
    set status = 'expired'::public.reveal_status,
        summary = pg_catalog.jsonb_build_object(
          'match_count', coalesce(pg_catalog.jsonb_array_length(r.matches), 0),
          'mismatch_count', coalesce(pg_catalog.jsonb_array_length(r.mismatches), 0),
          'expired_at', pg_catalog.now()
        ),
        matches = null,
        mismatches = null
    where r.status = 'computed'::public.reveal_status
      and r.expires_at < pg_catalog.now()
    returning 1
  )
  select count(*)::integer into v_count from expired;
  return v_count;
end;
$$;

revoke all on function public.expire_old_reveals() from public, anon;
grant execute on function public.expire_old_reveals() to authenticated;

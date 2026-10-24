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
--     pairing. It has two legitimate callers: signed-in clients (lib/reveal.ts
--     calls it before reading a reveal) and the pg_cron job that
--     20260420000003 recommends scheduling. The cron job runs as a database
--     role with no JWT, so this allows an authenticated JWT *or* a privileged
--     database role, and rejects everything else.

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
  -- A signed-in client, or the pg_cron job running as a database role.
  if auth.uid() is null
     and pg_catalog.current_user not in ('postgres', 'supabase_admin') then
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

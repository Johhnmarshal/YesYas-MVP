-- Migration: 20261025000001_schedule_reveal_expiry.sql
--
-- Makes the 24-hour reveal expiry hold server-side.
--
-- The PRD promises that a reveal's specific items disappear after 24 hours and
-- only the summary ("you had 7 matches") persists. 20260420000003 wrote
-- expire_old_reveals() to do that and left a comment saying to schedule it
-- from pg_cron, which was never done. The only caller has been lib/reveal.ts,
-- so expiry has only ever happened when somebody opened the app — meaning a
-- couple who stop using YesYas! leave their matched items sitting readable
-- indefinitely. That is the opposite of the promise.
--
-- expire_old_reveals() now requires an authenticated JWT (20261024000004), so
-- cron cannot call it: a scheduled job has no JWT, and widening that function
-- back out would re-expose it. Instead this adds a sibling that does the same
-- work and is callable only by the scheduler.

create extension if not exists pg_cron;

create or replace function public.expire_old_reveals_scheduled()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
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

-- Scheduler only. No API role may reach this; the JWT-gated
-- public.expire_old_reveals() remains the one clients call.
revoke all on function public.expire_old_reveals_scheduled() from public, anon, authenticated;

comment on function public.expire_old_reveals_scheduled() is
  'Cron-only twin of expire_old_reveals(). Same work, no JWT requirement, no API-role grant.';

-- Every 15 minutes: expiry is a privacy deadline, so overshooting it by up to
-- a quarter of an hour is the tolerance, not a day.
select cron.schedule(
  'expire-reveals',
  '*/15 * * * *',
  $$select public.expire_old_reveals_scheduled()$$
);

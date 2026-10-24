-- Migration: 20261024000003_revoke_anon_rpc_execute.sql
--
-- Supabase's database linter flagged all 13 SECURITY DEFINER functions in
-- `public` as callable by the `anon` role over `/rest/v1/rpc/...`. Earlier
-- migrations did `revoke all ... from public` and `grant execute ... to
-- authenticated`, which looks sufficient but is not: Supabase ships
-- ALTER DEFAULT PRIVILEGES granting EXECUTE on new functions in `public` to
-- `anon`, `authenticated` and `service_role`. Revoking from PUBLIC does not
-- touch that explicit grant to `anon`, so every RPC stayed open to callers
-- with no session.
--
-- Most are not exploitable because they open with
-- `if auth.uid() is null then raise exception 'authentication required'`.
-- Two are:
--
--   * `is_pairing_member(uuid, uuid)` has no auth check and returns whether a
--     given user belongs to a given pairing — an unauthenticated membership
--     oracle for anyone holding the two UUIDs. The client never calls it; it
--     exists for `withdraw_reveal`, which invokes it as SECURITY DEFINER, so
--     EXECUTE is checked against the function owner and revoking it from both
--     `anon` and `authenticated` changes nothing internally.
--
--   * `expire_old_reveals()` has no auth check and writes: it expires reveals
--     across every pairing. It is idempotent and only touches rows already
--     past `expires_at`, so the damage is bounded, but an unauthenticated
--     caller should not be able to drive a mutating function at all. The app
--     calls it from `lib/reveal.ts`, so `authenticated` keeps EXECUTE.
--
-- The four trigger functions are not meant to be reachable as RPC by anyone.
-- Calling them directly errors, but exposing them is noise on the API surface.

-- ---------- Trigger functions: nobody calls these over HTTP ----------
revoke all on function public.consent_events_chain() from public, anon, authenticated;
revoke all on function public.consent_events_immutable() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;

-- ---------- Internal helper: not part of the client API ----------
revoke all on function public.is_pairing_member(uuid, uuid) from public, anon, authenticated;

-- ---------- Signed-in only RPCs ----------
-- Each is revoked from anon and PUBLIC, then re-granted to authenticated so the
-- intent is explicit rather than inherited from a default privilege.
revoke all on function public.create_pairing_invite() from public, anon;
grant execute on function public.create_pairing_invite() to authenticated;

revoke all on function public.preview_pairing_invite(text) from public, anon;
grant execute on function public.preview_pairing_invite(text) to authenticated;

revoke all on function public.accept_pairing_invite(text) from public, anon;
grant execute on function public.accept_pairing_invite(text) to authenticated;

revoke all on function public.update_pairing_status(uuid, public.pairing_status) from public, anon;
grant execute on function public.update_pairing_status(uuid, public.pairing_status) to authenticated;

revoke all on function public.trigger_reveal(uuid) from public, anon;
grant execute on function public.trigger_reveal(uuid) to authenticated;

revoke all on function public.withdraw_reveal(uuid) from public, anon;
grant execute on function public.withdraw_reveal(uuid) to authenticated;

revoke all on function public.request_therapist_export(uuid) from public, anon;
grant execute on function public.request_therapist_export(uuid) to authenticated;

revoke all on function public.expire_old_reveals() from public, anon;
grant execute on function public.expire_old_reveals() to authenticated;

revoke all on function public.delete_user_account() from public, anon;
grant execute on function public.delete_user_account() to authenticated;

-- ---------- Stop the default privilege re-opening this for future functions ----------
-- Without this, the next `create function` in public is granted to anon again.
alter default privileges in schema public revoke execute on functions from anon;

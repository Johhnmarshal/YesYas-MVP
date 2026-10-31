-- Migration: 20261031000001_dedupe_desire_library.sql
--
-- Desire library clean-up, from the 31 Oct design review. Three changes, plus
-- one to trigger_reveal so the first is safe.
--
-- 1. Retire 23 near-duplicates (active = false, never deleted).
--
--    Each duplicate is separately ratable and separately matchable, so a
--    couple who both like, say, ice play could rate different versions of it
--    and never match. Retiring rather than deleting keeps any rating that
--    references the row (desires.library_item_id is ON DELETE RESTRICT) and
--    keeps the consent history meaningful. Ratings are deliberately NOT moved
--    onto the kept item: the kept item has different wording, and a reveal
--    must only ever show text the person actually rated.
--
--    Production had 0 ratings when this was written (checked 2026-10-31), so
--    no real rating is affected today.
--
--   Sensory
--     silent-eye-blink-sync                -> kept: hands-and-eye-contact
--     forehead-to-forehead-calm            -> kept: synchronized-breathing
--     ice-cube-on-collarbones              -> kept: sensory-ice-and-breath
--     gentle-temple-acupressure            -> kept: scalp-and-temple-massage
--     gentle-ribcage-hug                   -> kept: five-minute-handshake-hug
--   Suggestive
--     sensory-contrast-velvet-ice          -> kept: sensory-ice-and-breath
--     undressing-with-eyes-closed          -> kept: slow-undressing
--     silk-blindfold-kissing               -> kept: blindfold-and-feather-touch
--     whispering-fantasies-at-twilight     -> kept: whispering-taboo-desire
--     erotic-compliment-exchange           -> kept: erotic-praise-list
--     slow-grazing-with-lips               -> kept: neck-and-collarbone-focus
--     warm-lotion-bottle-glide             -> kept: back-rub-with-oil
--     sensual-shower-soap-lather           -> kept: showering-together-candlelight
--     soft-restraint-with-fingers          -> kept: silk-ties-gentle-restraint
--     gentle-wrist-pinning-with-kisses     -> kept: silk-ties-gentle-restraint
--   Explicit
--     edging-with-prolonged-denial         -> kept: edging-the-receiving-partner
--     exploring-erotic-roleplay-scenario   -> kept: roleplay-strangers-meeting
--     deep-throat-or-slow-suction          -> kept: deep-throat-or-slow-oral
--     erotic-blindfold-surprise            -> kept: blindfolded-pleasure-surrender
--     submissive-surrender-protocol        -> kept: one-partner-in-charge-tonight
--     over-the-knee-spanking               -> kept: spanking-and-impact-play
--     whispered-explicit-dirty-talk        -> kept: talking-through-it-in-bed
--     guided-hand-manual-stimulation       -> kept: show-me-how-you-like-it
--
-- 2. Move hair-pulling out of the default tier.
--
--    Suggestive is the tier new users land on. Hair-pulling is a power
--    dynamic, which a trauma-informed list gates behind an explicit opt-in.
--    The two Suggestive wrist-hold items were retired above instead of moved,
--    because Explicit already has "Silk ties or held wrists".
--
-- 3. Fix the neck item.
--
--    Slug 'breath-play-and-chest-pressure', titled "Gentle chest pressure and
--    neck caress", while its description only ever described the chest and
--    collarbone. Pressure on the neck is one of the highest-risk practices in
--    the whole space and the item should not suggest it. The title and slug
--    now match the description, and the description says so explicitly.
--
-- 4. trigger_reveal ignores retired items.
--
--    Before this, the reveal joined desire_library_items without checking
--    `active`. A rating on a retired item cannot be seen or changed in the app
--    any more, so it must not produce a match. The 3-rating gate counts
--    active items only, for the same reason. The rest of the function is
--    unchanged from 20261025000004.

-- ---------- 1. retire near-duplicates ----------
update public.desire_library_items
set active = false
where slug in (
    'silent-eye-blink-sync',
    'forehead-to-forehead-calm',
    'ice-cube-on-collarbones',
    'gentle-temple-acupressure',
    'gentle-ribcage-hug',
    'sensory-contrast-velvet-ice',
    'undressing-with-eyes-closed',
    'silk-blindfold-kissing',
    'whispering-fantasies-at-twilight',
    'erotic-compliment-exchange',
    'slow-grazing-with-lips',
    'warm-lotion-bottle-glide',
    'sensual-shower-soap-lather',
    'soft-restraint-with-fingers',
    'gentle-wrist-pinning-with-kisses',
    'edging-with-prolonged-denial',
    'exploring-erotic-roleplay-scenario',
    'deep-throat-or-slow-suction',
    'erotic-blindfold-surprise',
    'submissive-surrender-protocol',
    'over-the-knee-spanking',
    'whispered-explicit-dirty-talk',
    'guided-hand-manual-stimulation'
  );

-- ---------- 2. hair-pulling: suggestive -> explicit ----------
update public.desire_library_items
set tier = 'explicit'::public.desire_tier
where slug = 'sensual-hair-pulling';

-- ---------- 3. neck item ----------
update public.desire_library_items
set slug = 'gentle-chest-pressure',
    title = 'Gentle palm pressure on the chest',
    description = 'Light, consensual palm pressure on the upper chest or collarbone to heighten presence. Never on the throat or neck.'
where slug = 'breath-play-and-chest-pressure';

-- ---------- 4. trigger_reveal: active items only ----------
create or replace function public.trigger_reveal(p_pairing_id uuid)
returns table (
  reveal_id uuid,
  status public.reveal_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_other uuid;
  v_window_id uuid;
  v_partner_ready timestamptz;
  v_caller_already_ready boolean := false;
  v_reveal_id uuid;
  v_matches jsonb;
  v_mismatches jsonb;
  v_last_revealed_at timestamptz;
  v_caller_ratings integer;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- Verify caller is a member of an active pairing.
  select
    case
      when p.inviter_user_id = v_user then p.invitee_user_id
      when p.invitee_user_id = v_user then p.inviter_user_id
    end
    into v_other
  from public.pairings p
  where p.id = p_pairing_id
    and p.status = 'active'::public.pairing_status;

  if v_other is null then
    raise exception 'not a member of an active pairing' using errcode = '42501';
  end if;

  -- Enforce 7-day cadence (R-03): Check if this pairing already had a reveal computed within 7 days.
  select r.revealed_at
    into v_last_revealed_at
  from public.reveals r
  where r.pairing_id = p_pairing_id
    and r.status = 'computed'::public.reveal_status
    and r.revealed_at > pg_catalog.now() - interval '7 days'
  order by r.revealed_at desc
  limit 1;

  if v_last_revealed_at is not null then
    raise exception 'Reveal cadence limit: you can only reveal once every 7 days on the standard cadence' using errcode = 'P0001';
  end if;

  -- A reveal consumes the 7-day cadence whether or not it has anything to say.
  --
  -- The most natural first thing a new couple does is tap the big button to
  -- see what it does, before rating a single item. That produced a perfectly
  -- valid reveal of {"match_count": 0, "mismatch_count": 0} and then locked
  -- the product's headline feature for a week behind "you can only reveal
  -- once every 7 days". Measured on the hosted project: the retry immediately
  -- afterwards raises P0001 even once both partners have rated items.
  --
  -- Solo ratings are not a gap here: accept_pairing_invite copies every
  -- pairing_id-is-null desire for both users into the new pairing, so anyone
  -- who explored solo first already passes this check.
  select pg_catalog.count(*)
    into v_caller_ratings
  from public.desires d
  join public.desire_library_items li on li.id = d.library_item_id
  where d.user_id = v_user
    and d.pairing_id = p_pairing_id
    and li.active;

  if v_caller_ratings < 3 then
    raise exception
      'Rate at least 3 items before revealing. You have rated %.',
      v_caller_ratings
      using errcode = 'P0002';
  end if;

  -- Check if the partner has an active readiness entry within the 72-hour window.
  select rr.reveal_window_id, rr.ready_at
    into v_window_id, v_partner_ready
  from public.reveal_readiness rr
  where rr.pairing_id = p_pairing_id
    and rr.user_id = v_other
    and rr.ready_at > pg_catalog.now() - interval '72 hours'
  order by rr.ready_at desc
  limit 1;

  -- If partner is not ready yet, check if caller already has an active readiness window.
  if v_window_id is null then
    select rr.reveal_window_id, true
      into v_window_id, v_caller_already_ready
    from public.reveal_readiness rr
    where rr.pairing_id = p_pairing_id
      and rr.user_id = v_user
      and rr.ready_at > pg_catalog.now() - interval '72 hours'
    order by rr.ready_at desc
    limit 1;
  end if;

  if v_window_id is null then
    v_window_id := extensions.gen_random_uuid();
  end if;

  -- Record caller readiness in this window (idempotent).
  insert into public.reveal_readiness (pairing_id, user_id, reveal_window_id)
  values (p_pairing_id, v_user, v_window_id)
  on conflict (pairing_id, user_id, reveal_window_id) do nothing;

  -- Both partners ready? Compute double-blind intersection and Curiosity Bridge.
  if v_partner_ready is not null then
    with
      a as (
        select d.library_item_id, d.rating
        from public.desires d
        where d.user_id = v_user
          and d.pairing_id = p_pairing_id
      ),
      b as (
        select d.library_item_id, d.rating
        from public.desires d
        where d.user_id = v_other
          and d.pairing_id = p_pairing_id
      ),
      joined as (
        select
          li.id as library_item_id,
          li.slug,
          li.title,
          li.description,
          li.tier,
          a.rating as a_rating,
          b.rating as b_rating
        from a
        inner join b on b.library_item_id = a.library_item_id
        inner join public.desire_library_items li on li.id = a.library_item_id
        -- Hard veto on <= 2: any item rated 1 or 2 by either partner is strictly excluded.
        where a.rating > 2
          and b.rating > 2
          -- Retired items never surface, even if both partners rated them
          -- before retirement: a user can no longer see or change that
          -- rating, so it must not speak for them in a reveal.
          and li.active
      )
    select
      coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'library_item_id', j.library_item_id,
            'slug', j.slug,
            'title', j.title,
            'description', j.description,
            'tier', j.tier
          )
          order by j.slug
        ) filter (where j.a_rating >= 4 and j.b_rating >= 4),
        '[]'::jsonb
      ),
      coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'library_item_id', j.library_item_id,
            'slug', j.slug,
            'title', j.title,
            'tier', j.tier
          )
          order by j.slug
        ) filter (
          where (j.a_rating >= 4 and j.b_rating = 3)
             or (j.a_rating = 3 and j.b_rating >= 4)
        ),
        '[]'::jsonb
      )
      into v_matches, v_mismatches
    from joined j;

    -- Look up existing open reveal row for this pairing.
    select r.id
      into v_reveal_id
    from public.reveals r
    where r.pairing_id = p_pairing_id
      and r.status in ('pending'::public.reveal_status, 'both_ready'::public.reveal_status)
    order by r.triggered_at desc
    limit 1
    for update;

    if v_reveal_id is not null then
      update public.reveals r
      set status = 'computed'::public.reveal_status,
          both_ready_at = pg_catalog.now(),
          revealed_at = pg_catalog.now(),
          expires_at = pg_catalog.now() + interval '24 hours',
          matches = v_matches,
          mismatches = v_mismatches,
          summary = pg_catalog.jsonb_build_object(
            'match_count', coalesce(pg_catalog.jsonb_array_length(v_matches), 0),
            'mismatch_count', coalesce(pg_catalog.jsonb_array_length(v_mismatches), 0)
          )
      where r.id = v_reveal_id;
    else
      insert into public.reveals (
        pairing_id,
        status,
        triggered_by,
        both_ready_at,
        revealed_at,
        expires_at,
        matches,
        mismatches,
        summary
      )
      values (
        p_pairing_id,
        'computed'::public.reveal_status,
        v_user,
        pg_catalog.now(),
        pg_catalog.now(),
        pg_catalog.now() + interval '24 hours',
        v_matches,
        v_mismatches,
        pg_catalog.jsonb_build_object(
          'match_count', coalesce(pg_catalog.jsonb_array_length(v_matches), 0),
          'mismatch_count', coalesce(pg_catalog.jsonb_array_length(v_mismatches), 0)
        )
      )
      returning id into v_reveal_id;
    end if;

    -- Consume readiness rows for this pairing so subsequent reveals start fresh.
    delete from public.reveal_readiness rr
    where rr.pairing_id = p_pairing_id;

    -- Log reveal_triggered for the caller and reveal_revealed for both partners.
    insert into public.consent_events (user_id, pairing_id, event_type, payload)
    values
      (v_user, p_pairing_id, 'reveal_triggered'::public.consent_event_type, pg_catalog.jsonb_build_object('reveal_id', v_reveal_id, 'window_id', v_window_id, 'role', 'caller')),
      (v_user, p_pairing_id, 'reveal_revealed'::public.consent_event_type, pg_catalog.jsonb_build_object('reveal_id', v_reveal_id)),
      (v_other, p_pairing_id, 'reveal_revealed'::public.consent_event_type, pg_catalog.jsonb_build_object('reveal_id', v_reveal_id));

    return query
    select v_reveal_id, 'computed'::public.reveal_status;
    return;
  end if;

  -- Partner is not ready yet: insert or retain pending reveal.
  select r.id
    into v_reveal_id
  from public.reveals r
  where r.pairing_id = p_pairing_id
    and r.status = 'pending'::public.reveal_status
  order by r.triggered_at desc
  limit 1;

  if v_reveal_id is null then
    insert into public.reveals (
      pairing_id,
      status,
      triggered_by,
      summary
    )
    values (
      p_pairing_id,
      'pending'::public.reveal_status,
      v_user,
      '{"match_count": 0, "mismatch_count": 0}'::jsonb
    )
    returning id into v_reveal_id;

    insert into public.consent_events (user_id, pairing_id, event_type, payload)
    values (v_user, p_pairing_id, 'reveal_triggered', pg_catalog.jsonb_build_object('reveal_id', v_reveal_id, 'state', 'waiting_for_partner'));
  end if;

  return query
  select v_reveal_id, 'pending'::public.reveal_status;
end;
$$;


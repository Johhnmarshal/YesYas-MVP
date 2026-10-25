-- Migration: 20261025000005_normalise_library_slug.sql
--
-- One of the 180 library slugs carries a capital letter:
--
--   asking-for-what-I-want   ("Asking for what I want, out loud")
--
-- Every other slug is lowercase kebab-case. On its own that is cosmetic —
-- slug has a unique constraint but no foreign key, and `desires` references
-- `id`, so nothing is keyed on it.
--
-- The trap is supabase/seed.sql, which ends with `on conflict (slug) do
-- nothing`. Lowercasing the slug in the seed without also correcting the
-- hosted row would make the next seed run insert a SECOND, near-identical
-- item: 181 rows, two entries with the same title, both ratable, both
-- separately matchable in a reveal. Correcting the seed and the database has
-- to happen together, which is why this migration exists rather than just a
-- seed edit.
--
-- Written to be safe in either order and to re-run harmlessly: it only acts
-- when the old slug is present and the new one is not.

update public.desire_library_items
set slug = 'asking-for-what-i-want'
where slug = 'asking-for-what-I-want'
  and not exists (
    select 1
    from public.desire_library_items other
    where other.slug = 'asking-for-what-i-want'
  );

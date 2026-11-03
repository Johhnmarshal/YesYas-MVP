-- Migration: 20261103000002_journal_author.sql
--
-- Record who wrote each journal row.
--
-- A coach reply used to be saved exactly like something the person wrote, so
-- the journal could not tell them apart: Past Reflections listed replies as
-- if they were the person's own words, and above the reflection they
-- answered. Bodies are encrypted on the device, so the server cannot work out
-- the author afterwards; it has to be stored alongside.
--
-- Existing rows default to 'user'. The app recognises the old built-in
-- replies by their fixed opening sentence (lib/journal-threads.ts).

alter table public.journal_entries
  add column if not exists author text not null default 'user'
    check (author in ('user', 'coach'));

comment on column public.journal_entries.author is
  'Who wrote the row: the person, or the reflective coach replying in the same thread.';

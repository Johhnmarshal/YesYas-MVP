-- YesYas! v1 — Desire Library seed
-- 15 starter items across the three tiers. This is a placeholder set to make
-- the reveal engine testable. Before public beta, co-author a 150-200 item
-- library with a queer sex educator. Items here are intentionally muted and
-- non-explicit so they work for early-stage user testing.

insert into public.desire_library_items (slug, title, description, tier, tone_tags, locale) values
  -- Sensory (entry tier)
  ('slow-morning-together',     'A slow morning together',
   'Unhurried time together in the morning — coffee, conversation, no phones.',
   'sensory',   array['romantic','playful'], 'en-US'),
  ('reading-to-each-other',     'Reading to each other',
   'One of you reads aloud to the other for 15 minutes.',
   'sensory',   array['romantic'],           'en-US'),
  ('hands-and-eye-contact',     'Hands and eye contact',
   'Five minutes of holding hands and looking at each other without speaking.',
   'sensory',   array['romantic'],           'en-US'),
  ('cooking-something-new',     'Cooking something new together',
   'Pick a recipe neither of you has made before. Cook it together.',
   'sensory',   array['playful','direct'],   'en-US'),
  ('dancing-in-the-kitchen',    'Dancing in the kitchen',
   'One song. No audience.',
   'sensory',   array['playful','romantic'], 'en-US'),

  -- Suggestive (default tier)
  ('written-note-of-appreciation', 'Written note of appreciation',
   'A handwritten note listing three specific things one loves about the other.',
   'suggestive', array['romantic'],          'en-US'),
  ('shared-playlist-for-us',       'A shared playlist, just for us',
   'Each adds five songs that feel like the relationship. No overlap allowed.',
   'suggestive', array['playful','romantic'],'en-US'),
  ('unrushed-kissing',             'Unrushed kissing',
   'Ten minutes of kissing. No expectation of anything after.',
   'suggestive', array['romantic'],          'en-US'),
  ('slow-undressing',              'Slow undressing',
   'One of you undresses the other, slowly, without talking.',
   'suggestive', array['romantic'],          'en-US'),
  ('back-rub-with-oil',            'A back rub with oil',
   'Fifteen minutes. No reciprocation expected in the moment.',
   'suggestive', array['romantic','direct'], 'en-US'),

  -- Explicit (opt-in tier)
  ('fantasy-written-down',         'A fantasy, written down',
   'Each writes a fantasy they have not shared aloud. Exchange. No pressure to act.',
   'explicit',   array['direct'],            'en-US'),
  ('asking-for-what-I-want',       'Asking for what I want, out loud',
   'One partner says what they want in bed tonight. The other responds honestly.',
   'explicit',   array['direct','playful'],  'en-US'),
  ('sex-in-a-new-place',           'Intimacy in a new place',
   'Somewhere in the home you haven''t been intimate before.',
   'explicit',   array['playful'],           'en-US'),
  ('toys-together',                'Exploring a toy together',
   'Pick one out together. Try it once. Debrief honestly after.',
   'explicit',   array['direct','playful'],  'en-US'),
  ('long-session',                 'A longer session, no agenda',
   'Block 90 minutes with no plan beyond being together.',
   'explicit',   array['romantic','direct'], 'en-US')
on conflict (slug) do nothing;

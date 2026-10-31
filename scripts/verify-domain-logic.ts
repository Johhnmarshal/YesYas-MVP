import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import type { ConsentEventRow } from '../lib/consent';
// @ts-expect-error TS5097: Node 24 --experimental-strip-types requires explicit .ts extension
import { computeConsentPayloadHash, verifyConsentChain } from '../lib/consent.ts';
// @ts-expect-error TS5097: Node 24 --experimental-strip-types requires explicit .ts extension
import { hashPin, verifyPin, MasterKeyUnavailableError, adoptMasterKey, bytesToHex, clearMasterKey, decryptForUser, decryptText, encryptForUser, encryptText, exportMasterKey, generateRecoveryCode, hasMasterKey, hashUserIdForLogging, isValidRecoveryCode, normalizeRecoveryCode, provisionMasterKey, sha256Hex, unwrapMasterKey, wrapMasterKey } from '../lib/crypto.ts';

// @ts-expect-error TS5097: Node 24 --experimental-strip-types requires explicit .ts extension
import { TIER_ORDER, filterLibraryItems, isLibraryItemVisible, isTierWithinCeiling, reconcileTierFilter } from '../lib/library-filter.ts';

// @ts-expect-error TS5097: Node 24 --experimental-strip-types requires explicit .ts extension
import { isReadinessWindowClosed, isRevealContentExpired } from '../lib/reveal-state.ts';

// @ts-expect-error TS5097: Node 24 --experimental-strip-types requires explicit .ts extension
import { describePairingError } from '../lib/pairing-errors.ts';

// @ts-expect-error TS5097: Node 24 --experimental-strip-types requires explicit .ts extension
import { RatingRequiredError, ratingForNewNote } from '../lib/desire-note-rules.ts';

// @ts-expect-error TS5097: Node 24 --experimental-strip-types requires explicit .ts extension
import { parseAuthUrl } from '../lib/auth-url.ts';

async function main() {
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';

  // 0. A device with no key must refuse to encrypt rather than mint a new one.
  //    Silent key generation is what made reinstalls destroy journals.
  assert.equal(await hasMasterKey(userA), false, 'Fresh user must start with no device key');
  await assert.rejects(
    async () => encryptText('anything', userA),
    (err: unknown) => err instanceof MasterKeyUnavailableError,
    'Encrypting without a device key must throw MasterKeyUnavailableError',
  );
  await assert.rejects(
    async () => decryptText('enc:v1:00:00:00', userA),
    (err: unknown) => err instanceof MasterKeyUnavailableError,
    'Decrypting without a device key must throw MasterKeyUnavailableError',
  );

  await provisionMasterKey(userA);
  await provisionMasterKey(userB);
  assert.ok(await hasMasterKey(userA), 'Provisioning must leave a usable device key');

  // Provisioning twice must not replace an existing key.
  const keyBeforeReprovision = bytesToHex(await exportMasterKey(userA));
  await provisionMasterKey(userA);
  assert.equal(
    bytesToHex(await exportMasterKey(userA)),
    keyBeforeReprovision,
    'Re-provisioning must not rotate an existing key',
  );

  // 1. Encrypt produces enc:v1: ciphertext and hides plaintext
  const plain = 'My secret desire note';
  const cipher = await encryptText(plain, userA);
  assert.ok(cipher.startsWith('enc:v1:'), 'Ciphertext must start with enc:v1:');
  assert.ok(!cipher.toLowerCase().includes('secret'), 'Ciphertext must not leak plaintext');

  // 2. Decrypt recovers plaintext losslessly (ASCII + Unicode/emoji)
  const recovered = await decryptText(cipher, userA);
  assert.equal(recovered, plain, 'Decrypted text must match original');

  const unicodePlain = '🔒 Spark ✨ — Candlelight & warmth';
  const unicodeCipher = await encryptText(unicodePlain, userA);
  const unicodeRecovered = await decryptText(unicodeCipher, userA);
  assert.equal(unicodeRecovered, unicodePlain, 'Unicode/emoji plaintext must round-trip losslessly');

  // 3. Decrypt with wrong user key or tampered ciphertext/MAC throws authentication error
  await assert.rejects(
    async () => decryptText(cipher, userB),
    (err: unknown) => err instanceof Error && err.message.includes('Decryption authentication failed'),
    'Decrypting with different user key must fail authentication',
  );

  const parts = cipher.split(':');
  // Tamper with ciphertext hex
  const lastHexChar = parts[3].slice(-1);
  const flippedChar = lastHexChar === '0' ? '1' : '0';
  const tamperedCipher = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3].slice(0, -1)}${flippedChar}:${parts[4]}`;
  await assert.rejects(
    async () => decryptText(tamperedCipher, userA),
    (err: unknown) => err instanceof Error && err.message.includes('Decryption authentication failed'),
    'Decrypting tampered ciphertext must fail authentication',
  );

  // Tamper with MAC tag
  const lastMacChar = parts[4].slice(-1);
  const flippedMacChar = lastMacChar === '0' ? '1' : '0';
  const tamperedMac = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:${parts[4].slice(0, -1)}${flippedMacChar}`;
  await assert.rejects(
    async () => decryptText(tamperedMac, userA),
    (err: unknown) => err instanceof Error && err.message.includes('Decryption authentication failed'),
    'Decrypting tampered MAC must fail authentication',
  );

  // 4. Legacy plaintext note returns unchanged
  const legacy = 'legacy plaintext note';
  assert.equal(await decryptText(legacy, userA), legacy, 'Legacy plaintext must pass through unchanged');

  // 4b. encryptForUser / decryptForUser and hashUserIdForLogging
  const journalNote = 'Private solo journal entry with reflections';
  const journalCipher = await encryptForUser(journalNote, userA);
  assert.ok(journalCipher.startsWith('enc:v1:'));
  assert.equal(await decryptForUser(journalCipher, userA), journalNote);

  const hashedUser = hashUserIdForLogging(userA);
  assert.equal(hashedUser.length, 64, 'User ID hash must be 64-char hex SHA-256');
  assert.equal(hashedUser, hashUserIdForLogging(userA), 'User ID hash must be deterministic');
  assert.notEqual(hashedUser, hashUserIdForLogging(userB), 'Different users must yield distinct hashes');

  // 4c. Recovery codes: format, checksum, normalisation, and key round-trip
  const recoveryCode = generateRecoveryCode();
  assert.match(
    recoveryCode,
    /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/,
    'Recovery code must be six hyphenated groups of four Crockford base32 characters',
  );
  assert.ok(isValidRecoveryCode(recoveryCode), 'A generated code must pass its own checksum');
  assert.ok(
    isValidRecoveryCode(recoveryCode.toLowerCase().replace(/-/g, ' ')),
    'Codes must validate case-insensitively and ignore separators',
  );
  assert.ok(
    !isValidRecoveryCode(recoveryCode.slice(0, -1)),
    'A truncated code must fail the checksum',
  );
  assert.equal(
    normalizeRecoveryCode('o0-il1'),
    '00111',
    'O must fold to 0 and I/L must fold to 1',
  );

  // Wrapping and unwrapping must return the very same key bytes. Uses a lower
  // iteration count than production so CI stays fast; the stored parameter is
  // what unwrap honours.
  const TEST_ITERATIONS = 1000;
  const masterKeyHex = bytesToHex(await exportMasterKey(userA));
  const wrapped = await wrapMasterKey(await exportMasterKey(userA), recoveryCode, TEST_ITERATIONS);
  assert.ok(wrapped.wrappedKey.startsWith('enc:v1:'), 'Wrapped key must use the enc:v1: envelope');
  assert.ok(!wrapped.wrappedKey.includes(masterKeyHex), 'Wrapped blob must not contain the raw key');
  assert.equal(wrapped.iterations, TEST_ITERATIONS);
  assert.match(wrapped.salt, /^[0-9a-f]{32}$/, 'Salt must be 16 bytes of hex');

  assert.equal(
    bytesToHex(await unwrapMasterKey(wrapped, recoveryCode)),
    masterKeyHex,
    'Unwrapping with the right code must recover the exact key',
  );
  assert.equal(
    bytesToHex(await unwrapMasterKey(wrapped, recoveryCode.toLowerCase())),
    masterKeyHex,
    'Unwrapping must accept a lowercased code',
  );

  const otherCode = generateRecoveryCode();
  await assert.rejects(
    async () => unwrapMasterKey(wrapped, otherCode),
    (err: unknown) => err instanceof Error && err.message.includes('Decryption authentication failed'),
    'Unwrapping with the wrong code must fail authentication',
  );

  // The point of the whole exercise: a wiped device recovers old ciphertext.
  const preWipeCipher = await encryptText('note written before the reinstall', userA);
  await clearMasterKey(userA);
  assert.equal(await hasMasterKey(userA), false, 'Clearing must remove the device key');
  await assert.rejects(
    async () => decryptText(preWipeCipher, userA),
    (err: unknown) => err instanceof MasterKeyUnavailableError,
    'A wiped device must report a missing key, not a corrupt note',
  );
  await adoptMasterKey(userA, await unwrapMasterKey(wrapped, recoveryCode));
  assert.equal(
    await decryptText(preWipeCipher, userA),
    'note written before the reinstall',
    'Recovery code must restore access to content written before the wipe',
  );

  // 4d. Device PIN is stored as a verifier, never as the PIN
  const pin = '481620';
  const pinVerifier = await hashPin(pin);
  assert.ok(pinVerifier.startsWith('pin:v1:'), 'PIN verifier must use the pin:v1: envelope');
  assert.ok(!pinVerifier.includes(pin), 'PIN verifier must not contain the PIN itself');
  assert.ok(await verifyPin(pin, pinVerifier), 'Correct PIN must verify');
  assert.ok(!(await verifyPin('481621', pinVerifier)), 'Wrong PIN must not verify');

  // Same PIN, fresh salt each time — two users with the same PIN must not
  // share a verifier.
  assert.notEqual(await hashPin(pin), pinVerifier, 'Each hashPin call must use a new salt');

  // A corrupted verifier fails the unlock rather than throwing, so the lock
  // screen cannot be crashed into an open state.
  for (const bad of ['', 'garbage', 'pin:v1:xx:50000:yy', 'pin:v2:aa:50000:bb']) {
    assert.equal(await verifyPin(pin, bad), false, `Malformed verifier must return false: ${bad}`);
  }

  // 5. Consent hash chain verification
  const event1Base = {
    id: 'aaaa1111-1111-4111-8111-111111111111',
    user_id: userA,
    pairing_id: 'bbbb2222-2222-4222-8222-222222222222',
    event_type: 'pairing_accepted' as const,
    payload: { role: 'inviter' },
    prev_hash: null,
    created_at: '2026-06-01T10:00:00.000Z',
  };
  const event1: ConsentEventRow = {
    seq: 1,
    ...event1Base,
    payload_hash: computeConsentPayloadHash(event1Base),
  };

  const event2Base = {
    id: 'aaaa2222-2222-4222-8222-222222222222',
    user_id: userA,
    pairing_id: 'bbbb2222-2222-4222-8222-222222222222',
    event_type: 'reveal_triggered' as const,
    payload: { window_id: 'cccc3333-3333-4333-8333-333333333333' },
    prev_hash: event1.payload_hash,
    created_at: '2026-06-01T11:00:00.000Z',
  };
  const event2: ConsentEventRow = {
    seq: 2,
    ...event2Base,
    payload_hash: computeConsentPayloadHash(event2Base),
  };

  const validChain: ConsentEventRow[] = [event1, event2];
  assert.deepEqual(
    verifyConsentChain(validChain),
    { valid: true, brokenAtId: null },
    'Valid consent chain must pass verification',
  );

  // Mutate payload on event 1
  const mutatedPayloadChain: ConsentEventRow[] = [
    { ...event1, payload: { role: 'tampered' } },
    event2,
  ];
  assert.deepEqual(
    verifyConsentChain(mutatedPayloadChain),
    { valid: false, brokenAtId: event1.id },
    'Mutated payload on row 1 must be detected at row 1',
  );

  // Mutate prev_hash on event 2
  const mutatedPrevHashChain: ConsentEventRow[] = [
    event1,
    { ...event2, prev_hash: sha256Hex('forged-prev-hash') },
  ];
  assert.deepEqual(
    verifyConsentChain(mutatedPrevHashChain),
    { valid: false, brokenAtId: event2.id },
    'Mutated prev_hash on row 2 must be detected at row 2',
  );

  // 6. UUID thread validation regex
  const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.ok(UUID_REGEX.test('a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d'), 'Valid v4 UUID must pass');
  assert.ok(!UUID_REGEX.test('invalid-thread-id'), 'Malformed thread ID must fail');
  assert.ok(!UUID_REGEX.test('1740000000-abc123'), 'Legacy timestamp-random thread ID must fail');
  assert.ok(!UUID_REGEX.test(''), 'Empty string must fail');

  // 7. Therapist export count fallback logic (curiosity_count / mismatch_count)
  const calcCuriosity = (summaryObj: Record<string, unknown>) =>
    typeof summaryObj.curiosity_count === 'number'
      ? summaryObj.curiosity_count
      : typeof summaryObj.mismatch_count === 'number'
        ? summaryObj.mismatch_count
        : 0;
  assert.equal(calcCuriosity({ curiosity_count: 5, mismatch_count: 2 }), 5);
  assert.equal(calcCuriosity({ mismatch_count: 3 }), 3);
  assert.equal(calcCuriosity({}), 0);
  assert.equal(calcCuriosity({ mismatch_count: 'invalid' }), 0);


  // 8. The content tier ceiling is never exceeded, whatever the tier filter says.
  //
  //    Regression: the Library screen applied the ceiling only when the tier
  //    filter was 'up_to_ceiling', trusting its tap handler to never select a
  //    locked tier. The ceiling can move underneath a selection though —
  //    choose Explicit, lower the content tier to Sensory in Settings, return
  //    to the Library — and the screen stays mounted, refreshing the ceiling on
  //    focus without touching the filter. Every explicit item kept rendering
  //    under a padlocked pill.
  const libraryFixture = [
    { tier: 'sensory' as const,    tone_tags: ['romantic'], title: 'Slow morning',   description: 'Unhurried.' },
    { tier: 'suggestive' as const, tone_tags: ['playful'],  title: 'Teasing note',   description: 'A hint.' },
    { tier: 'explicit' as const,   tone_tags: ['direct'],   title: 'Explicit item',  description: 'Plain.' },
  ];

  assert.equal(
    filterLibraryItems(libraryFixture, {
      tierCeiling: 'sensory',
      tierFilter: 'explicit',
      toneFilter: 'all',
      searchQuery: '',
    }).length,
    0,
    'An explicit tier filter under a sensory ceiling must list nothing',
  );

  assert.equal(
    isLibraryItemVisible(libraryFixture[2], {
      tierCeiling: 'suggestive',
      tierFilter: 'explicit',
      toneFilter: 'all',
      searchQuery: '',
    }),
    false,
    'An above-ceiling item must stay hidden even when the filter names its tier',
  );

  assert.equal(
    filterLibraryItems(libraryFixture, {
      tierCeiling: 'explicit',
      tierFilter: 'up_to_ceiling',
      toneFilter: 'all',
      searchQuery: '',
    }).length,
    3,
    'An explicit ceiling must still show all three tiers',
  );

  // Search and tone narrow within the ceiling, never past it.
  assert.deepEqual(
    filterLibraryItems(libraryFixture, {
      tierCeiling: 'suggestive',
      tierFilter: 'up_to_ceiling',
      toneFilter: 'all',
      searchQuery: '  PLAIN  ',
    }).map((i) => i.title),
    [],
    'Search must not reach an item the ceiling excludes',
  );
  assert.deepEqual(
    filterLibraryItems(libraryFixture, {
      tierCeiling: 'suggestive',
      tierFilter: 'up_to_ceiling',
      toneFilter: 'playful',
      searchQuery: '',
    }).map((i) => i.title),
    ['Teasing note'],
    'Tone filter must select within the ceiling',
  );

  // Status filter (all, unrated, rated) respects user ratings while maintaining tier ceiling
  const ratingsMap = new Map([
    ['Slow morning', 4],
    ['Explicit item', 5],
  ]); // 'Teasing note' is unrated

  assert.deepEqual(
    filterLibraryItems(
      libraryFixture,
      {
        tierCeiling: 'explicit',
        tierFilter: 'up_to_ceiling',
        toneFilter: 'all',
        statusFilter: 'all',
        searchQuery: '',
      },
      (item) => ratingsMap.get(item.title) ?? null,
    ).map((i) => i.title),
    ['Slow morning', 'Teasing note', 'Explicit item'],
    'statusFilter "all" returns all items within ceiling',
  );

  assert.deepEqual(
    filterLibraryItems(
      libraryFixture,
      {
        tierCeiling: 'explicit',
        tierFilter: 'up_to_ceiling',
        toneFilter: 'all',
        statusFilter: 'unrated',
        searchQuery: '',
      },
      (item) => ratingsMap.get(item.title) ?? null,
    ).map((i) => i.title),
    ['Teasing note'],
    'statusFilter "unrated" returns only unrated items within ceiling',
  );

  assert.deepEqual(
    filterLibraryItems(
      libraryFixture,
      {
        tierCeiling: 'explicit',
        tierFilter: 'up_to_ceiling',
        toneFilter: 'all',
        statusFilter: 'rated',
        searchQuery: '',
      },
      (item) => ratingsMap.get(item.title) ?? null,
    ).map((i) => i.title),
    ['Slow morning', 'Explicit item'],
    'statusFilter "rated" returns only rated items within ceiling',
  );

  assert.deepEqual(
    filterLibraryItems(
      libraryFixture,
      {
        tierCeiling: 'sensory',
        tierFilter: 'up_to_ceiling',
        toneFilter: 'all',
        statusFilter: 'rated',
        searchQuery: '',
      },
      (item) => ratingsMap.get(item.title) ?? null,
    ).map((i) => i.title),
    ['Slow morning'],
    'statusFilter "rated" under sensory ceiling never breaches tier ceiling',
  );

  // A selection the ceiling no longer permits collapses back to the safe default.
  assert.equal(reconcileTierFilter('explicit', 'sensory'), 'up_to_ceiling',
    'Lowering the ceiling must drop a now-locked tier filter');
  assert.equal(reconcileTierFilter('sensory', 'explicit'), 'sensory',
    'A filter still under the ceiling must survive');
  assert.equal(reconcileTierFilter('up_to_ceiling', 'sensory'), 'up_to_ceiling',
    'The default filter is always valid');
  assert.ok(TIER_ORDER.sensory < TIER_ORDER.suggestive && TIER_ORDER.suggestive < TIER_ORDER.explicit,
    'Tier ranking must be strictly increasing');


  // 9. An empty consent log verifies vacuously, and that is deliberate.
  //
  //    verifyConsentChain([]) returns valid: true because the loop never
  //    runs. The settings/consent.tsx badge must therefore distinguish "empty"
  //    from "verified" itself — it used to show a green "Cryptographic
  //    Hash-Chain Verified" shield over zero records, which every new tester
  //    saw, since consent events only begin when you pair.
  //
  //    Pinned here so the opposite fix is not attempted: making this return
  //    valid: false for an empty log would mean a brand-new account showing an
  //    integrity FAILURE, which is worse. The emptiness check belongs in the
  //    screen, and this assertion is what says so.
  assert.deepEqual(
    verifyConsentChain([]),
    { valid: true, brokenAtId: null },
    'An empty consent log must verify vacuously; the UI distinguishes empty from verified',
  );


  // 10. The ceiling predicate itself, used by both enforcement points.
  //
  //     The library list and the item detail screen each have to apply the
  //     ceiling, and each was missing it at some point today — the list only
  //     applied it on one filter branch, and the detail screen, which fetches
  //     by id, never read the user's preference at all. Both now call this.
  assert.ok(isTierWithinCeiling('sensory', 'sensory'), 'equal tiers are within the ceiling');
  assert.ok(isTierWithinCeiling('sensory', 'explicit'), 'a lower tier is within a higher ceiling');
  assert.ok(!isTierWithinCeiling('explicit', 'sensory'), 'explicit is not within a sensory ceiling');
  assert.ok(!isTierWithinCeiling('explicit', 'suggestive'), 'explicit is not within a suggestive ceiling');
  assert.ok(!isTierWithinCeiling('suggestive', 'sensory'), 'suggestive is not within a sensory ceiling');


  // 11. Reveal deadlines are decided identically on both screens.
  //
  //     expire_old_reveals runs on a 15-minute cron, so a row can sit at
  //     'computed' with expires_at already past. The reveal screen checked
  //     that inline; the home screen did not, and announced "Active reveal:
  //     N mutual matches" for up to a quarter of an hour after the reveal
  //     screen had started calling it expired. Nothing at all closes the
  //     72-hour readiness window server-side, so an unchecked client says
  //     "waiting for your partner" indefinitely.
  const HOUR = 60 * 60 * 1000;
  const t0 = Date.parse('2026-10-25T12:00:00Z');

  const computedFresh = {
    status: 'computed' as const,
    triggered_at: new Date(t0 - 2 * HOUR).toISOString(),
    revealed_at: new Date(t0 - 2 * HOUR).toISOString(),
    expires_at: new Date(t0 + 22 * HOUR).toISOString(),
  };
  const computedStale = {
    ...computedFresh,
    expires_at: new Date(t0 - 1 * HOUR).toISOString(),
  };

  assert.equal(isRevealContentExpired(computedFresh, t0), false,
    'a computed reveal inside its window is not expired');
  assert.equal(isRevealContentExpired(computedStale, t0), true,
    'a computed reveal past expires_at is expired even before the cron runs');
  assert.equal(isRevealContentExpired({ ...computedFresh, status: 'expired' as const }, t0), true,
    'an already-expired row is expired');
  assert.equal(isRevealContentExpired({ ...computedFresh, status: 'pending' as const }, t0), false,
    'a pending reveal has no content to expire');
  assert.equal(isRevealContentExpired(null, t0), false, 'no reveal is not an expired reveal');

  // expires_at missing: fall back to 24h after revealed_at, which is t0 - 2h,
  // so the fallback deadline is t0 + 22h.
  assert.equal(
    isRevealContentExpired({ ...computedFresh, expires_at: null }, t0 + 21 * HOUR),
    false,
    'without expires_at, 23 hours after the reveal is still inside the window',
  );
  assert.equal(
    isRevealContentExpired({ ...computedFresh, expires_at: null }, t0 + 23 * HOUR),
    true,
    'without expires_at, 25 hours after the reveal is expired',
  );

  const pendingFresh = {
    status: 'pending' as const,
    triggered_at: new Date(t0 - 10 * HOUR).toISOString(),
    revealed_at: null,
    expires_at: null,
  };
  assert.equal(isReadinessWindowClosed(pendingFresh, t0), false,
    '10 hours into a 72-hour window is still open');
  assert.equal(
    isReadinessWindowClosed(
      { ...pendingFresh, triggered_at: new Date(t0 - 73 * HOUR).toISOString() },
      t0,
    ),
    true,
    '73 hours after triggering, the readiness window has closed',
  );
  assert.equal(isReadinessWindowClosed(computedFresh, t0), false,
    'the readiness window only applies to a pending reveal');
  assert.equal(isReadinessWindowClosed(null, t0), false, 'no reveal has no window');


  // 12. Pairing errors reach the user as sentences, not as Postgres.
  //
  //     The one that prompted this: pause a pairing, pair with someone else,
  //     then resume the first. update_pairing_status has no active-pairing
  //     check of its own, so the partial unique index catches it and raises
  //
  //       duplicate key value violates unique constraint
  //       "pairings_one_active_inviter"
  //
  //     Measured on the hosted project. The invariant held; the wording did
  //     not. PairingManageModal routes status transitions through this mapper,
  //     so the index message was going straight to the screen.
  const FALLBACK = 'fallback text';

  assert.equal(
    describePairingError(
      new Error('duplicate key value violates unique constraint "pairings_one_active_inviter"'),
      FALLBACK,
    ),
    'You already have another active pairing. End or pause that one first, then resume this one.',
    'the inviter-side active-pairing index is explained, not echoed',
  );
  assert.equal(
    describePairingError(
      new Error('duplicate key value violates unique constraint "pairings_one_active_invitee"'),
      FALLBACK,
    ),
    'You already have another active pairing. End or pause that one first, then resume this one.',
    'the invitee-side index gets the same explanation',
  );

  // The RPC-level checks keep their own wording.
  assert.match(
    describePairingError(new Error('one of the users already has an active pairing'), FALLBACK),
    /already paired with someone/,
    'the RPC active-pairing check keeps its own message',
  );
  assert.match(
    describePairingError(new Error('invite code has expired'), FALLBACK),
    /only last 48 hours/,
    'an expired invite says how long they last',
  );
  assert.match(
    describePairingError(new Error('inviter cannot accept own invite'), FALLBACK),
    /your own invite link/,
    'self-accept is explained',
  );

  // Anything unrecognised must fall through rather than guess.
  assert.equal(
    describePairingError(new Error('some unmapped postgres thing'), FALLBACK),
    FALLBACK,
    'an unmapped error uses the caller fallback',
  );
  assert.equal(describePairingError(null, FALLBACK), FALLBACK, 'null uses the fallback');
  assert.equal(describePairingError(undefined, FALLBACK), FALLBACK, 'undefined uses the fallback');


  // 13. Every (app) route is declared in the Tabs layout.
  //
  //     expo-router turns each route under a <Tabs> layout into a visible tab
  //     unless it is declared with href: null. settings/privacy-model was not
  //     declared, so the bottom bar carried a fifth tab reading
  //     "privacy-model" beside Home, Library, Journal and Settings.
  //
  //     This is a filesystem check rather than a logic one because the bug is
  //     an omission: adding a screen and forgetting the declaration is the
  //     natural mistake, and nothing else in the pipeline notices.
  const appDir = path.join(import.meta.dirname, '..', 'app', '(app)');
  const layoutSrc = fs.readFileSync(path.join(appDir, '_layout.tsx'), 'utf8');

  const declared = new Set(
    [...layoutSrc.matchAll(/name="([^"]+)"/g)].map((m) => m[1]),
  );

  const routeFiles: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.tsx') && entry.name !== '_layout.tsx') {
        const base = entry.name.replace(/\.tsx$/, '');
        routeFiles.push(prefix ? `${prefix}/${base}` : base);
      }
    }
  };
  walk(appDir, '');

  const undeclared = routeFiles.filter((r) => !declared.has(r)).sort();
  assert.deepEqual(
    undeclared,
    [],
    `every (app) route must be declared in the Tabs layout, or it renders as its own tab. Undeclared: ${undeclared.join(', ')}`,
  );


  // 14. Golden vectors from rows the database actually wrote.
  //
  //     Every other consent assertion in this file builds its rows in
  //     TypeScript and then checks TypeScript against itself, which is why a
  //     total mismatch with Postgres survived: consent_events_chain() hashes
  //     `new.payload::text`, and jsonb sorts object keys by (byte length,
  //     bytes) rather than alphabetically.
  //
  //     Both reveal_triggered payloads are affected:
  //       {reveal_id, state}           -> jsonb emits state first
  //       {reveal_id, window_id, role} -> jsonb emits role first
  //
  //     so verifyConsentChain reported { valid: false } for every couple that
  //     had triggered a reveal, and settings/consent.tsx told them their audit
  //     trail had been tampered with.
  //
  //     These two rows were produced by trigger_reveal() against the hosted
  //     project inside a rolled-back transaction, and the hashes are copied
  //     from the database verbatim. Hand-written fixtures cannot catch this
  //     class of bug; only the real serialisation can.
  const genesisRow: ConsentEventRow = {
    seq: 74,
    id: '82506105-a979-4b9d-ab3e-b2145790f189',
    user_id: 'd1d1d1d1-1111-4111-8111-d1d1d1d1d1d1',
    pairing_id: null,
    event_type: 'pairing_accepted',
    payload: { role: 'inviter' },
    payload_hash: '1fc4ae960f8e48711e714d047b99adc8c73e437c3276ccd34d4b6a0731eaa418',
    prev_hash: null,
    created_at: '2026-10-25T12:00:00.000Z',
  };
  // Two keys, and jsonb puts the shorter one first: {"state": ..., "reveal_id": ...}
  const multiKeyRow: ConsentEventRow = {
    seq: 76,
    id: '32833ae7-d189-4839-9cd7-0be35fb3e998',
    user_id: 'd1d1d1d1-1111-4111-8111-d1d1d1d1d1d1',
    pairing_id: null,
    event_type: 'reveal_triggered',
    payload: {
      state: 'waiting_for_partner',
      reveal_id: 'b9fef755-f7da-4e34-9acb-261e1fea573e',
    },
    payload_hash: 'a4144570ffd6dc1c8b4b65a3d44a83171a4a5dbc0ac7aab88768fe8e125f67cc',
    prev_hash: '1fc4ae960f8e48711e714d047b99adc8c73e437c3276ccd34d4b6a0731eaa418',
    created_at: '2026-10-25T12:00:01.000Z',
  };

  assert.equal(
    computeConsentPayloadHash(genesisRow),
    genesisRow.payload_hash,
    'single-key payload must hash to what Postgres stored',
  );
  assert.equal(
    computeConsentPayloadHash(multiKeyRow),
    multiKeyRow.payload_hash,
    'multi-key payload must hash to what Postgres stored (jsonb key order, not alphabetical)',
  );

  //     And the chain these two form must verify, since that is what the
  //     consent screen actually calls.
  assert.deepEqual(
    verifyConsentChain([genesisRow, multiKeyRow]),
    { valid: true, brokenAtId: null },
    'a real two-row chain from the database must verify as intact',
  );

  //     A full three-row chain from one completed reveal, including the
  //     three-key caller payload. jsonb orders it role(4), reveal_id(9),
  //     window_id(9) — length first, then bytes, so reveal_id precedes
  //     window_id. Alphabetical order would have put reveal_id first overall
  //     and produced a different hash.
  const realChain: ConsentEventRow[] = [
    {
      seq: 78,
      id: '44b70963-b8b3-4a94-b0a8-70a169b7fb92',
      user_id: 'f8f8f8f8-2222-4222-8222-f8f8f8f8f8f8',
      pairing_id: null,
      event_type: 'pairing_accepted',
      payload: { role: 'invitee' },
      payload_hash: '6ff5341e5d00cbb1bcad705e399e3472fc5ef2c38aa3099aeec9ab479fa4f691',
      prev_hash: null,
      created_at: '2026-10-25T12:00:00.000Z',
    },
    {
      seq: 80,
      id: 'f2a72574-2ad2-4946-ace1-323d7cc448c1',
      user_id: 'f8f8f8f8-2222-4222-8222-f8f8f8f8f8f8',
      pairing_id: null,
      event_type: 'reveal_triggered',
      payload: {
        role: 'caller',
        reveal_id: 'f79706fd-6b51-46ce-a273-4a89c0a3655a',
        window_id: '2d6e029e-e98e-4b40-9239-dfa83d022a0c',
      },
      payload_hash: 'ec652c2dc440b68427ea81185203e0853a1c0d73c03d06dac6f8c08c9df04058',
      prev_hash: '6ff5341e5d00cbb1bcad705e399e3472fc5ef2c38aa3099aeec9ab479fa4f691',
      created_at: '2026-10-25T12:00:01.000Z',
    },
    {
      seq: 81,
      id: 'b392682c-825b-4fd6-bde4-bf3928732d55',
      user_id: 'f8f8f8f8-2222-4222-8222-f8f8f8f8f8f8',
      pairing_id: null,
      event_type: 'reveal_revealed',
      payload: { reveal_id: 'f79706fd-6b51-46ce-a273-4a89c0a3655a' },
      payload_hash: 'c223470b4be0fe0790018d6e98870d0e2423f839537100ff599522d261e74520',
      prev_hash: 'ec652c2dc440b68427ea81185203e0853a1c0d73c03d06dac6f8c08c9df04058',
      created_at: '2026-10-25T12:00:02.000Z',
    },
  ];

  for (const row of realChain) {
    assert.equal(
      computeConsentPayloadHash(row),
      row.payload_hash,
      `${row.event_type} (${Object.keys(row.payload as object).length} keys) must hash to what Postgres stored`,
    );
  }
  assert.deepEqual(
    verifyConsentChain(realChain),
    { valid: true, brokenAtId: null },
    'a real completed-reveal chain must verify as intact',
  );

  // Key insertion order in the fixture must not matter — jsonb has none.
  const reordered: ConsentEventRow = {
    ...multiKeyRow,
    payload: {
      reveal_id: 'b9fef755-f7da-4e34-9acb-261e1fea573e',
      state: 'waiting_for_partner',
    },
  };
  assert.equal(
    computeConsentPayloadHash(reordered),
    multiKeyRow.payload_hash,
    'the hash must not depend on the order keys appear in the JS object',
  );


  // 15. A note never invents a rating.
  //
  //     desires.rating is NOT NULL with CHECK (1..5), so a note cannot be
  //     stored without one. The client used to default it to 3, which is
  //     exactly trigger_reveal()'s Curiosity Bridge threshold:
  //
  //       veto    rating > 2            3 survives
  //       match   both >= 4             3 is not a match
  //       bridge  (a >= 4 and b = 3) or (a = 3 and b >= 4)
  //
  //     So a private note on an unrated item recorded a 3, and if the partner
  //     rated it 4 or 5 the item surfaced in the couple's shared Curiosity
  //     Bridge as something one of them was "open to exploring". Verified
  //     against the hosted project: the note-only item came back inside
  //     reveals.mismatches.
  assert.throws(
    () => ratingForNewNote(null),
    (err: unknown) => err instanceof RatingRequiredError,
    'a new note with no rating must be refused, not defaulted',
  );
  // Specifically: it must never silently become the bridge value.
  assert.notEqual(
    (() => { try { return ratingForNewNote(null); } catch { return 'threw'; } })(),
    3,
    'the refusal must not fall back to 3, the Curiosity Bridge threshold',
  );

  for (const valid of [1, 2, 3, 4, 5]) {
    assert.equal(
      ratingForNewNote(valid),
      valid,
      `a rating the user actually gave (${valid}) passes through unchanged`,
    );
  }

  // Out-of-range values are named here rather than surfacing as a Postgres
  // constraint violation.
  for (const bad of [0, 6, -1, 2.5]) {
    assert.throws(
      () => ratingForNewNote(bad),
      (err: unknown) => err instanceof RatingRequiredError,
      `${bad} is outside desires_rating_check and must be refused`,
    );
  }


  // 16. Auth URL parsing, for web and for a custom-scheme deep link.
  //
  //     This is the code path that decides whether somebody gets signed in,
  //     and until now it existed only inline in lib/supabase.ts, gated on
  //     window.location, so native had nothing and nothing was tested.
  //
  //     The deep-link cases matter most: `new URL()` treats non-special
  //     schemes like yesyasapp:// differently across Node and React Native's
  //     polyfill, and the polyfill has historically dropped the fragment. The
  //     parser uses index arithmetic for that reason, and these assertions are
  //     what say it works on the shapes that actually arrive.

  // The magic-link template's own form: {{ .SiteURL }}/?token_hash=..&type=email
  assert.deepEqual(
    parseAuthUrl('https://yesyas.vercel.app/?token_hash=abc123&type=email'),
    { kind: 'token_hash', tokenHash: 'abc123', type: 'email' },
    'web query token_hash is read',
  );
  // Same thing arriving at the native scheme, which is what yesyasapp:/// gets.
  assert.deepEqual(
    parseAuthUrl('yesyasapp:///?token_hash=abc123&type=email'),
    { kind: 'token_hash', tokenHash: 'abc123', type: 'email' },
    'deep-link query token_hash is read',
  );
  // type defaults to email rather than being dropped.
  assert.deepEqual(
    parseAuthUrl('yesyasapp:///?token_hash=abc123'),
    { kind: 'token_hash', tokenHash: 'abc123', type: 'email' },
    'a missing type defaults to email',
  );
  assert.deepEqual(
    parseAuthUrl('yesyasapp:///?token_hash=abc&type=recovery'),
    { kind: 'token_hash', tokenHash: 'abc', type: 'recovery' },
    'a non-default type is preserved',
  );
  // Fragment form, both platforms.
  assert.deepEqual(
    parseAuthUrl('yesyasapp:///#token_hash=xyz&type=email'),
    { kind: 'token_hash', tokenHash: 'xyz', type: 'email' },
    'fragment token_hash is read on a deep link',
  );

  // Implicit flow needs both halves.
  assert.deepEqual(
    parseAuthUrl('yesyasapp:///#access_token=AT&refresh_token=RT'),
    { kind: 'session', accessToken: 'AT', refreshToken: 'RT' },
    'implicit flow with both tokens establishes a session',
  );
  assert.equal(
    parseAuthUrl('yesyasapp:///#access_token=AT'),
    null,
    'an access_token with no refresh_token is not a session',
  );
  assert.equal(
    parseAuthUrl('yesyasapp:///#refresh_token=RT'),
    null,
    'a refresh_token alone is not a session',
  );

  // PKCE.
  assert.deepEqual(
    parseAuthUrl('https://yesyas.vercel.app/?code=pkce-code'),
    { kind: 'code', code: 'pkce-code' },
    'PKCE code is read from the query',
  );

  // token_hash wins: verifyOtp works without the verifier the code needs.
  assert.deepEqual(
    parseAuthUrl('https://yesyas.vercel.app/?code=c&token_hash=t&type=email'),
    { kind: 'token_hash', tokenHash: 't', type: 'email' },
    'token_hash takes precedence over code',
  );

  // Nothing to do.
  for (const nothing of [
    null,
    undefined,
    '',
    'yesyasapp:///',
    'https://yesyas.vercel.app/',
    'https://yesyas.vercel.app/?error=access_denied&error_code=otp_expired',
  ]) {
    assert.equal(
      parseAuthUrl(nothing as string | null | undefined),
      null,
      `no auth parameters in ${JSON.stringify(nothing)}`,
    );
  }

  // 17. Theme Token Integrity Linter: Ban raw hex color literals in app/ and components/
  const uiDirs = ['app', 'components'];
  const hexPattern = /#([0-9a-fA-F]{3,8})\b/g;
  const hexViolations: { file: string; line: number; match: string }[] = [];

  function scanDirForHex(dirPath: string) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        scanDirForHex(fullPath);
      } else if (entry.name.endsWith('.tsx')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split(/\r?\n/);
        lines.forEach((line, idx) => {
          const matches = line.match(hexPattern);
          if (matches) {
            for (const m of matches) {
              hexViolations.push({ file: fullPath, line: idx + 1, match: m });
            }
          }
        });
      }
    }
  }

  for (const dir of uiDirs) {
    const abs = path.resolve(import.meta.dirname ?? '.', '..', dir);
    if (fs.existsSync(abs)) {
      scanDirForHex(abs);
    }
  }

  assert.equal(
    hexViolations.length,
    0,
    `Found unapproved hardcoded hex color literals in UI code: ${JSON.stringify(hexViolations)}`,
  );

  console.log('PASS: All crypto, consent hash-chain and library-filter assertions succeeded.');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});

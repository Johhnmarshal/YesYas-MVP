import assert from 'node:assert/strict';

import type { ConsentEventRow } from '../lib/consent';
// @ts-expect-error TS5097: Node 24 --experimental-strip-types requires explicit .ts extension
import { computeConsentPayloadHash, verifyConsentChain } from '../lib/consent.ts';
// @ts-expect-error TS5097: Node 24 --experimental-strip-types requires explicit .ts extension
import { hashPin, verifyPin, MasterKeyUnavailableError, adoptMasterKey, bytesToHex, clearMasterKey, decryptForUser, decryptText, encryptForUser, encryptText, exportMasterKey, generateRecoveryCode, hasMasterKey, hashUserIdForLogging, isValidRecoveryCode, normalizeRecoveryCode, provisionMasterKey, sha256Hex, unwrapMasterKey, wrapMasterKey } from '../lib/crypto.ts';

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

  console.log('PASS: All crypto and consent hash-chain assertions succeeded.');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});

import assert from 'node:assert/strict';

import type { ConsentEventRow } from '../lib/consent';
// @ts-expect-error TS5097: Node 24 --experimental-strip-types requires explicit .ts extension
import { computeConsentPayloadHash, verifyConsentChain } from '../lib/consent.ts';
// @ts-expect-error TS5097: Node 24 --experimental-strip-types requires explicit .ts extension
import { decryptForUser, decryptText, encryptForUser, encryptText, hashUserIdForLogging, sha256Hex } from '../lib/crypto.ts';

async function main() {
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';

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

  console.log('PASS: All crypto and consent hash-chain assertions succeeded.');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});

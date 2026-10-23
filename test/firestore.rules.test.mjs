/**
 * Firestore security-rules tests.
 *
 * These rules ARE the privacy model for Yes Yas!, so the cases below are
 * written as attacks first and happy paths second. Run with:
 *
 *   npm run test:rules
 *
 * The suite deliberately includes a regression test for the pairing hole that
 * existed before the consent handshake: a stranger could write
 * { isPaired, partnerUids } onto any other user's profile, force a mutual
 * pairing, and then read that user's journal.
 */
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  arrayUnion,
} from 'firebase/firestore';

// Underscore-free on purpose: pairId is "uidA_uidB", so a uid containing
// '_' would break the split() in the pair rules. Real Auth uids are
// 28-char alphanumeric, and these mimic that.
const ALICE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const EVE = 'eeeeeeeeeeeeeeeeeeeeeeeeeeee';
const PAIR_AB = [ALICE, BOB].sort().join('_');

let testEnv;
let passed = 0;
const failures = [];

async function it(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n      ${err?.message ?? err}`);
  }
}

function profile(uid, name, partnerUids = []) {
  return {
    uid,
    displayName: name,
    email: `${name.toLowerCase()}@example.com`,
    connectionCode: name.toUpperCase().padEnd(6, 'X').slice(0, 6),
    isPaired: partnerUids.length > 0,
    partnerUids,
    createdAt: new Date().toISOString(),
  };
}

/** Reset to a known state: three users, none paired. */
async function seed({ mutualAB = false } = {}) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ALICE), profile(ALICE, 'Alice', mutualAB ? [BOB] : []));
    await setDoc(doc(db, 'users', BOB), profile(BOB, 'Bob', mutualAB ? [ALICE] : []));
    await setDoc(doc(db, 'users', EVE), profile(EVE, 'Eve'));
    for (const [uid, name] of [[ALICE, 'Alice'], [BOB, 'Bob'], [EVE, 'Eve']]) {
      await setDoc(doc(db, 'public_profiles', uid), {
        uid,
        displayName: name,
        createdAt: new Date().toISOString(),
      });
      await setDoc(doc(db, 'pairing_codes', name.toUpperCase().padEnd(6, 'X').slice(0, 6)), {
        uid,
        displayName: name,
        createdAt: new Date().toISOString(),
      });
    }
  });
}

async function main() {
  testEnv = await initializeTestEnvironment({
    projectId: 'yesyas-rules-test',
    firestore: {
      // RULES_FILE lets you point the suite at another rules file, e.g. to
      // confirm a regression test actually fails against the old rules.
      rules: readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });

  const alice = () => testEnv.authenticatedContext(ALICE, { email: 'alice@example.com' }).firestore();
  const eve = () => testEnv.authenticatedContext(EVE, { email: 'eve@example.com' }).firestore();
  const bob = () => testEnv.authenticatedContext(BOB, { email: 'bob@example.com' }).firestore();
  const anon = () => testEnv.unauthenticatedContext().firestore();

  console.log('\n/users — nobody writes another user\'s profile');
  await seed();
  await it('REGRESSION: Eve cannot force herself into Alice\'s partnerUids', async () => {
    await assertFails(
      updateDoc(doc(eve(), 'users', ALICE), { isPaired: true, partnerUids: arrayUnion(EVE) })
    );
  });
  await it('REGRESSION: Eve cannot overwrite Alice\'s partnerUids wholesale', async () => {
    await assertFails(updateDoc(doc(eve(), 'users', ALICE), { partnerUids: [EVE], isPaired: true }));
  });
  await it('Eve cannot read Alice\'s private profile', async () => {
    await assertFails(getDoc(doc(eve(), 'users', ALICE)));
  });
  await it('Alice cannot list all users', async () => {
    await assertFails(getDocs(collection(alice(), 'users')));
  });
  await it('Alice can read her own profile', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'users', ALICE)));
  });
  await it('Alice can add a partner to her own profile', async () => {
    await assertSucceeds(
      updateDoc(doc(alice(), 'users', ALICE), { isPaired: true, partnerUids: arrayUnion(BOB) })
    );
  });
  await it('Alice cannot pair with herself', async () => {
    await assertFails(
      updateDoc(doc(alice(), 'users', ALICE), { isPaired: true, partnerUids: arrayUnion(ALICE) })
    );
  });
  await it('unauthenticated access is denied', async () => {
    await assertFails(getDoc(doc(anon(), 'users', ALICE)));
  });

  console.log('\n/pairing_codes — resolvable only if you already know the code');
  await seed();
  await it('Eve cannot enumerate pairing codes', async () => {
    await assertFails(getDocs(collection(eve(), 'pairing_codes')));
  });
  await it('Eve cannot query codes by uid', async () => {
    await assertFails(getDocs(query(collection(eve(), 'pairing_codes'), where('uid', '==', ALICE))));
  });
  await it('Alice can resolve a code she already knows', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'pairing_codes', 'ALICEX')));
  });
  await it('Eve cannot steal a code that is already claimed', async () => {
    await assertFails(
      setDoc(doc(eve(), 'pairing_codes', 'ALICEX'), {
        uid: EVE,
        displayName: 'Eve',
        createdAt: new Date().toISOString(),
      })
    );
  });
  await it('Eve cannot claim a code pointing at someone else', async () => {
    await assertFails(
      setDoc(doc(eve(), 'pairing_codes', 'NEWCD1'), {
        uid: ALICE,
        displayName: 'Alice',
        createdAt: new Date().toISOString(),
      })
    );
  });
  await it('Alice can claim an unused code for herself', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'pairing_codes', 'FRESH1'), {
        uid: ALICE,
        displayName: 'Alice',
        createdAt: new Date().toISOString(),
      })
    );
  });

  console.log('\n/public_profiles — not enumerable, no codes inside');
  await seed();
  await it('Eve cannot enumerate the user base', async () => {
    await assertFails(getDocs(collection(eve(), 'public_profiles')));
  });
  await it('Alice can fetch a known uid\'s display name', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'public_profiles', BOB)));
  });
  await it('Alice cannot write a connectionCode into her public profile', async () => {
    await assertFails(
      setDoc(doc(alice(), 'public_profiles', ALICE), {
        uid: ALICE,
        displayName: 'Alice',
        connectionCode: 'ALICEX',
        createdAt: new Date().toISOString(),
      })
    );
  });
  await it('Eve cannot write Alice\'s public profile', async () => {
    await assertFails(
      setDoc(doc(eve(), 'public_profiles', ALICE), {
        uid: ALICE,
        displayName: 'Pwned',
        createdAt: new Date().toISOString(),
      })
    );
  });

  console.log('\n/pair_requests — the consent handshake');
  await seed();
  await it('Alice can file a request for Bob at the deterministic id', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'pair_requests', `${ALICE}_${BOB}`), {
        from: ALICE,
        to: BOB,
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
    );
  });
  await it('Alice cannot file a request at a mismatched id', async () => {
    await assertFails(
      setDoc(doc(alice(), 'pair_requests', `${ALICE}_${EVE}`), {
        from: ALICE,
        to: BOB,
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
    );
  });
  await it('Eve cannot file a request impersonating Alice', async () => {
    await assertFails(
      setDoc(doc(eve(), 'pair_requests', `${ALICE}_${BOB}`), {
        from: ALICE,
        to: BOB,
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
    );
  });
  await it('a request cannot be created pre-accepted', async () => {
    await assertFails(
      setDoc(doc(alice(), 'pair_requests', `${ALICE}_${BOB}`), {
        from: ALICE,
        to: BOB,
        status: 'accepted',
        createdAt: new Date().toISOString(),
      })
    );
  });

  // Seed a live pending request for the accept/decline cases.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'pair_requests', `${ALICE}_${BOB}`), {
      from: ALICE,
      to: BOB,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
  });
  await it('Bob (the invitee) can accept', async () => {
    await assertSucceeds(
      updateDoc(doc(bob(), 'pair_requests', `${ALICE}_${BOB}`), {
        status: 'accepted',
        respondedAt: new Date().toISOString(),
      })
    );
  });
  await it('Alice cannot accept her own request', async () => {
    await assertFails(
      updateDoc(doc(alice(), 'pair_requests', `${ALICE}_${BOB}`), { status: 'accepted' })
    );
  });
  await it('Eve cannot read a request between Alice and Bob', async () => {
    await assertFails(getDoc(doc(eve(), 'pair_requests', `${ALICE}_${BOB}`)));
  });
  await it('Eve cannot list requests addressed to Bob', async () => {
    await assertFails(getDocs(query(collection(eve(), 'pair_requests'), where('to', '==', BOB))));
  });
  await it('Bob can list requests addressed to him', async () => {
    await assertSucceeds(getDocs(query(collection(bob(), 'pair_requests'), where('to', '==', BOB))));
  });
  await it('Alice can list requests she sent', async () => {
    await assertSucceeds(
      getDocs(query(collection(alice(), 'pair_requests'), where('from', '==', ALICE)))
    );
  });
  await it('the invitee cannot rewrite from/to while answering', async () => {
    await assertFails(updateDoc(doc(bob(), 'pair_requests', `${ALICE}_${BOB}`), { from: EVE }));
  });
  await it('Alice can withdraw her own request', async () => {
    await assertSucceeds(deleteDoc(doc(alice(), 'pair_requests', `${ALICE}_${BOB}`)));
  });

  console.log('\n/pairs — pair-scoped data requires BOTH sides to reciprocate');
  await seed({ mutualAB: false });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    // Only Alice has added Bob — a half-finished handshake.
    await setDoc(doc(ctx.firestore(), 'users', ALICE), profile(ALICE, 'Alice', [BOB]));
  });
  await it('a one-sided pairing grants no journal access', async () => {
    await assertFails(
      setDoc(doc(alice(), 'pairs', PAIR_AB, 'journal', 'e1'), {
        authorId: ALICE,
        content: 'hello',
        isPrivate: false,
        createdAt: new Date().toISOString(),
      })
    );
  });

  await seed({ mutualAB: true });
  await it('a mutual pairing allows a shared entry', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'pairs', PAIR_AB, 'journal', 'e1'), {
        authorId: ALICE,
        content: 'hello',
        isPrivate: false,
        createdAt: new Date().toISOString(),
      })
    );
  });
  await it('Eve cannot read a pair she is not part of', async () => {
    await assertFails(getDoc(doc(eve(), 'pairs', PAIR_AB, 'journal', 'e1')));
  });
  await it('Bob can read Alice\'s shared entry', async () => {
    await assertSucceeds(getDoc(doc(bob(), 'pairs', PAIR_AB, 'journal', 'e1')));
  });
  await it('an entry cannot be authored as someone else', async () => {
    await assertFails(
      setDoc(doc(alice(), 'pairs', PAIR_AB, 'journal', 'e2'), {
        authorId: BOB,
        content: 'forged',
        isPrivate: false,
        createdAt: new Date().toISOString(),
      })
    );
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'pairs', PAIR_AB, 'journal', 'secret'), {
      authorId: ALICE,
      content: 'private thought',
      isPrivate: true,
      createdAt: new Date().toISOString(),
    });
  });
  await it('a private entry is not readable by the partner', async () => {
    await assertFails(getDoc(doc(bob(), 'pairs', PAIR_AB, 'journal', 'secret')));
  });
  await it('a private entry is readable by its author', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'pairs', PAIR_AB, 'journal', 'secret')));
  });

  console.log('\n/users/{uid}/preferences — strictly private');
  await seed({ mutualAB: true });
  await it('Alice can save her own preference', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'users', ALICE, 'preferences', 'd1'), {
        userId: ALICE,
        desireId: 'd1',
        preference: 'Yes',
        updatedAt: new Date().toISOString(),
      })
    );
  });
  await it('a paired partner cannot read raw preferences', async () => {
    await assertFails(getDoc(doc(bob(), 'users', ALICE, 'preferences', 'd1')));
  });
  await it('an invalid preference value is rejected', async () => {
    await assertFails(
      setDoc(doc(alice(), 'users', ALICE, 'preferences', 'd2'), {
        userId: ALICE,
        desireId: 'd2',
        preference: 'Absolutely',
        updatedAt: new Date().toISOString(),
      })
    );
  });

  await testEnv.cleanup();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

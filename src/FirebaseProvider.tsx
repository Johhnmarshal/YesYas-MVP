import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, db } from './firebase';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';

interface FirebaseContextType {
  user: User | null;
  profile: any | null;
  loading: boolean;
  isAuthReady: boolean;
  /** Surfaces the most recent error from auto-creating the user profile (if any). */
  profileError: string | null;
}

const FirebaseContext = createContext<FirebaseContextType>({
  user: null,
  profile: null,
  loading: true,
  isAuthReady: false,
  profileError: null,
});

export const useFirebase = () => useContext(FirebaseContext);

/**
 * Generate a 6-character connection code. We avoid easily-confused characters
 * (0/O, 1/I/L) so testers reading the code over text or phone don't trip up.
 */
function generateConnectionCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return code;
}

/** Fallback display name when Google didn't supply one (rare but real). */
function fallbackDisplayName(user: User): string {
  if (user.displayName && user.displayName.trim().length > 0) return user.displayName.trim();
  if (user.email) return user.email.split('@')[0];
  return 'Friend';
}

/**
 * Claim a connection code by writing /pairing_codes/{CODE}, where the code is
 * the document id. Codes are no longer a queryable field on a listable
 * collection, so the only way to resolve one is to already know it — that's
 * what makes it usable as proof of consent when pairing.
 *
 * Rules deny `update` on this collection, so a setDoc onto a code somebody
 * else already holds fails rather than silently stealing it. We treat that as
 * a collision and try another code.
 */
async function claimPairingCode(uid: string, displayName: string, preferred?: string): Promise<string | null> {
  const candidates = preferred ? [preferred] : [];
  for (let i = candidates.length; i < 6; i++) candidates.push(generateConnectionCode());

  for (const code of candidates) {
    const ref = doc(db, 'pairing_codes', code);
    try {
      const existing = await getDoc(ref);
      if (existing.exists()) {
        // Already ours (re-provisioning, or a back-fill of an older account).
        if (existing.data()?.uid === uid) return code;
        continue;
      }
      await setDoc(ref, { uid, displayName, createdAt: new Date().toISOString() });
      return code;
    } catch (err) {
      // Someone claimed this code between our read and our write. Try the next.
      console.warn('Pairing code claim failed, retrying with a new code', code, err);
    }
  }
  return null;
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  // Track which uids we've already attempted to auto-create, so we don't loop.
  const provisioningAttempted = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (!u) {
        setProfile(null);
        setProfileError(null);
        setLoading(false);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) return;

    const userRef = doc(db, 'users', user.uid);

    const ensureProfileExists = async () => {
      if (provisioningAttempted.current.has(user.uid)) return;
      provisioningAttempted.current.add(user.uid);

      try {
        const snap = await getDoc(userRef);
        const publicRef = doc(db, 'public_profiles', user.uid);

        if (snap.exists()) {
          // Existing tester. Two back-fills, both invisible to them:
          //   1. Claim /pairing_codes/{code} for the code already on their
          //      profile, so code lookup keeps working under the new model.
          //   2. Rewrite /public_profiles without connectionCode — codes no
          //      longer belong in a doc that any signed-in user can read.
          const data = snap.data();
          const displayName = data?.displayName ?? fallbackDisplayName(user);

          const code = await claimPairingCode(user.uid, displayName, data?.connectionCode);
          if (code && code !== data?.connectionCode) {
            // Their old code was taken by someone else in the meantime.
            await setDoc(userRef, { ...data, connectionCode: code }, { merge: true });
          }

          // setDoc without merge so the stale connectionCode field is dropped.
          await setDoc(publicRef, {
            uid: user.uid,
            displayName,
            createdAt: data?.createdAt ?? new Date().toISOString(),
          });

          setProfileError(null);
          return;
        }

        // No profile yet — create it now so the tester never sees a "click to create" wall.
        const displayName = fallbackDisplayName(user);
        const createdAt = new Date().toISOString();

        // Claim the code first, so the code on the profile always resolves.
        const code = await claimPairingCode(user.uid, displayName);
        if (!code) {
          setProfileError(
            "We couldn't reserve a connection code for you. Please refresh to try again."
          );
          return;
        }

        await setDoc(userRef, {
          uid: user.uid,
          displayName,
          email: user.email ?? '',
          connectionCode: code,
          isPaired: false,
          partnerUids: [],
          createdAt,
        });

        await setDoc(publicRef, {
          uid: user.uid,
          displayName,
          createdAt,
        });

        setProfileError(null);
      } catch (err: any) {
        console.error('Failed to provision profile', err);
        setProfileError(
          "We couldn't set up your private profile. Please refresh — if this keeps happening, sign out and try again."
        );
      }
    };

    void ensureProfileExists();

    const unsubscribeProfile = onSnapshot(
      userRef,
      (snap) => {
        if (snap.exists()) {
          setProfile(snap.data());
          setProfileError(null);
        } else {
          setProfile(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error('Profile snapshot error', err);
        setProfileError("We couldn't load your profile. Please refresh.");
        setLoading(false);
      }
    );

    return () => {
      unsubscribeProfile();
    };
  }, [user]);

  return (
    <FirebaseContext.Provider value={{ user, profile, loading, isAuthReady, profileError }}>
      {children}
    </FirebaseContext.Provider>
  );
};

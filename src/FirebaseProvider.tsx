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
          // Existing tester — back-fill /public_profiles if it doesn't exist yet,
          // so they remain discoverable under the new lookup model. This is a
          // one-time migration that the tester won't notice.
          const data = snap.data();
          const publicSnap = await getDoc(publicRef);
          if (!publicSnap.exists() && data?.connectionCode && data?.displayName) {
            await setDoc(publicRef, {
              uid: user.uid,
              displayName: data.displayName,
              connectionCode: data.connectionCode,
              createdAt: data.createdAt ?? new Date().toISOString(),
            });
          }
          return;
        }

        // No profile yet — create it now so the tester never sees a "click to create" wall.
        const displayName = fallbackDisplayName(user);
        const code = generateConnectionCode();
        const createdAt = new Date().toISOString();

        await setDoc(userRef, {
          uid: user.uid,
          displayName,
          email: user.email ?? '',
          connectionCode: code,
          isPaired: false,
          partnerUids: [],
          createdAt,
        });

        // Mirror the lookup-able fields to /public_profiles so other users can find
        // this account by its connection code without exposing email / partnerUids.
        await setDoc(publicRef, {
          uid: user.uid,
          displayName,
          connectionCode: code,
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

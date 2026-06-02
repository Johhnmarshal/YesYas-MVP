import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  doc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  arrayUnion,
} from 'firebase/firestore';
import { useFirebase } from '../FirebaseProvider';
import { motion } from 'motion/react';
import { Copy, Check, Link as LinkIcon, Heart, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Pairing flow rewritten as two explicit, numbered steps so testers always know
 * what to do next. Profile creation is no longer a manual button — it happens
 * automatically in FirebaseProvider as soon as the user signs in.
 */
export const PairingFlow: React.FC = () => {
  const { user, profile, profileError } = useFirebase();
  const [partnerCode, setPartnerCode] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [partnerName, setPartnerName] = useState<string | null>(null);

  // Already paired? Look up the partner's display name (from /public_profiles) so the
  // UI can show "You're connected with Sam" rather than a bare ID.
  const firstPartnerUid: string | undefined = profile?.partnerUids?.[0];
  useEffect(() => {
    let cancelled = false;
    async function loadPartner() {
      if (!firstPartnerUid) {
        setPartnerName(null);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'public_profiles', firstPartnerUid));
        if (!cancelled && snap.exists()) {
          setPartnerName(snap.data().displayName ?? null);
        }
      } catch {
        // Non-fatal — we'll just show a generic label.
      }
    }
    void loadPartner();
    return () => {
      cancelled = true;
    };
  }, [firstPartnerUid]);

  const handleLinkPartner = async () => {
    if (!user || !partnerCode || isLinking) return;
    const code = partnerCode.trim().toUpperCase();
    setLinkError(null);

    if (code.length < 4) {
      setLinkError('Codes are 6 characters long. Double-check what your partner sent.');
      return;
    }
    if (profile?.connectionCode && code === profile.connectionCode) {
      setLinkError("That's your own code. Enter your partner's code, not yours.");
      return;
    }

    setIsLinking(true);
    try {
      // Search public_profiles (not /users) so we don't need broad read access to
      // anyone's email / partnerUids just to look up a code.
      const q = query(collection(db, 'public_profiles'), where('connectionCode', '==', code));
      const result = await getDocs(q);

      if (result.empty) {
        setLinkError(
          "We couldn't find anyone with that code. Make sure your partner has signed in and that you've copied their full 6-character code."
        );
        return;
      }

      const partnerDoc = result.docs[0];
      const partnerUid = partnerDoc.id;

      if (partnerUid === user.uid) {
        setLinkError("That's your own code. Enter your partner's code instead.");
        return;
      }
      if (profile?.partnerUids?.includes(partnerUid)) {
        setLinkError("You're already paired with this partner.");
        return;
      }

      // 1) Add the partner to my own profile.
      await updateDoc(doc(db, 'users', user.uid), {
        isPaired: true,
        partnerUids: arrayUnion(partnerUid),
      });

      // 2) Add me to my partner's profile. The firestore rule only allows this
      // narrow update — affected keys must be exactly { isPaired, partnerUids }
      // and the caller's UID must end up inside partnerUids.
      await updateDoc(doc(db, 'users', partnerUid), {
        isPaired: true,
        partnerUids: arrayUnion(user.uid),
      });

      toast.success('You and your partner are now connected.');
      setPartnerCode('');
    } catch (err: any) {
      console.error('Pairing failed', err);
      // The most common cause: rules rejected the second update because the
      // partner hasn't accepted us yet, or one side's profile is in a weird state.
      setLinkError(
        "We couldn't complete the pairing. Ask your partner to sign in first, then try again. If this keeps happening, refresh the page."
      );
    } finally {
      setIsLinking(false);
    }
  };

  const copyCode = () => {
    if (profile?.connectionCode) {
      navigator.clipboard.writeText(profile.connectionCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Code copied to clipboard');
    }
  };

  // Profile provisioning is still in flight.
  if (!profile) {
    return (
      <div className="text-center py-20">
        {profileError ? (
          <div className="max-w-md mx-auto glass-card p-6 border-l-4 border-red-400">
            <div className="flex items-center gap-2 mb-2 text-red-400">
              <AlertTriangle size={18} />
              <h2 className="font-bold">Something went wrong</h2>
            </div>
            <p className="text-sm opacity-80">{profileError}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 opacity-70">
            <Loader2 className="w-6 h-6 animate-spin text-sunset-gold" />
            <p className="text-sm">Setting up your private profile&hellip;</p>
          </div>
        )}
      </div>
    );
  }

  // Already paired — show a confirmation rather than the entry form.
  if (profile.isPaired && firstPartnerUid) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-8 max-w-md mx-auto text-center"
      >
        <div className="w-16 h-16 bg-sunset-gold/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <Heart className="text-sunset-gold fill-current w-8 h-8" />
        </div>
        <h2 className="text-2xl font-serif mb-2">You're connected</h2>
        <p className="text-sm opacity-70 mb-6">
          {partnerName ? (
            <>You and <span className="font-bold text-sunset-gold">{partnerName}</span> are paired.</>
          ) : (
            <>You're paired with your partner.</>
          )}{' '}
          Head over to the Library to start sharing your desires privately.
        </p>
        <p className="text-xs opacity-50">
          Need to add another partner? Share your code below or enter a new one.
        </p>

        <div className="bg-white/10 p-4 rounded-2xl mt-6 mb-4 flex items-center justify-between border border-white/20">
          <div className="text-left">
            <p className="text-xs uppercase tracking-widest opacity-50 mb-1">Your Connection Code</p>
            <p className="text-2xl font-mono font-bold tracking-tighter">{profile.connectionCode}</p>
          </div>
          <button
            onClick={copyCode}
            className="p-3 bg-sunset-gold text-oxblood rounded-xl hover:bg-sunset-gold/80 transition-colors"
            aria-label="Copy code"
          >
            {copied ? <Check size={20} /> : <Copy size={20} />}
          </button>
        </div>
      </motion.div>
    );
  }

  // Not yet paired — show the two-step pairing flow.
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-8 max-w-md mx-auto"
    >
      <h2 className="text-2xl font-serif mb-2 text-center">Pair with your partner</h2>
      <p className="text-sm opacity-70 mb-8 text-center">
        Both of you need a Yes Yas! account first. Then exchange codes — only one of you needs to enter
        the other's code.
      </p>

      {/* STEP 1 */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-7 h-7 rounded-full bg-sunset-gold text-oxblood text-sm font-bold flex items-center justify-center">
            1
          </span>
          <h3 className="font-bold">Send your code to your partner</h3>
        </div>
        <div className="bg-white/10 p-4 rounded-2xl flex items-center justify-between border border-white/20">
          <div>
            <p className="text-xs uppercase tracking-widest opacity-50 mb-1">Your code</p>
            <p className="text-2xl font-mono font-bold tracking-tighter">{profile.connectionCode}</p>
          </div>
          <button
            onClick={copyCode}
            className="p-3 bg-sunset-gold text-oxblood rounded-xl hover:bg-sunset-gold/80 transition-colors"
            aria-label="Copy code"
          >
            {copied ? <Check size={20} /> : <Copy size={20} />}
          </button>
        </div>
        <p className="text-xs opacity-50 mt-2">
          Text or message it to them. Don't share this code with anyone else.
        </p>
      </div>

      {/* STEP 2 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-7 h-7 rounded-full bg-sunset-gold text-oxblood text-sm font-bold flex items-center justify-center">
            2
          </span>
          <h3 className="font-bold">Or enter their code here</h3>
        </div>

        <div className="space-y-3">
          <div className="relative">
            <input
              type="text"
              value={partnerCode}
              onChange={(e) => {
                setPartnerCode(e.target.value.toUpperCase());
                if (linkError) setLinkError(null);
              }}
              placeholder="6-character code, e.g. AB3D5F"
              maxLength={6}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="w-full px-5 py-4 bg-white/10 border border-white/20 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sunset-gold transition-all text-moonlit-cream placeholder-moonlit-cream/50 font-mono tracking-widest text-center text-lg"
            />
            <LinkIcon className="absolute right-4 top-4 opacity-20" />
          </div>

          {linkError && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-400/30 text-red-200 text-sm"
            >
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{linkError}</span>
            </motion.div>
          )}

          <button
            onClick={handleLinkPartner}
            disabled={!partnerCode || isLinking}
            className="w-full py-4 bg-sunset-gold text-oxblood rounded-2xl font-bold shadow-lg hover:bg-sunset-gold/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {isLinking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Connecting&hellip;
              </>
            ) : (
              'Connect partner'
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
};

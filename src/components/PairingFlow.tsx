import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import {
  doc,
  updateDoc,
  setDoc,
  deleteDoc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot,
  arrayUnion,
} from 'firebase/firestore';
import { useFirebase } from '../FirebaseProvider';
import { motion } from 'motion/react';
import { Copy, Check, Link as LinkIcon, Heart, AlertTriangle, Loader2, Clock, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

interface PairRequest {
  id: string;
  from: string;
  to: string;
  status: 'pending' | 'accepted' | 'declined';
}

/**
 * Pairing is a two-sided handshake. Neither client can write the other user's
 * profile any more (the old rule that allowed it let a stranger force a
 * pairing and then read a victim's journal), so each side adds the other to
 * its OWN partnerUids:
 *
 *   1. The inviter resolves the code via /pairing_codes/{CODE} — a `get`, not
 *      a query, so codes stay non-enumerable — and files a pair request.
 *   2. The invitee accepts, which adds the inviter to the invitee's profile.
 *   3. The inviter's client sees the acceptance and adds the invitee to its own.
 *
 * Pair-scoped data stays locked until both sides have done their half, so a
 * half-finished handshake exposes nothing.
 */
export const PairingFlow: React.FC = () => {
  const { user, profile, profileError } = useFirebase();
  const [partnerCode, setPartnerCode] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [incoming, setIncoming] = useState<PairRequest[]>([]);
  const [outgoing, setOutgoing] = useState<PairRequest[]>([]);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const firstPartnerUid: string | undefined = profile?.partnerUids?.[0];

  /** Resolve a uid to a display name via /public_profiles (a get, not a list). */
  const resolveName = useCallback(async (uid: string) => {
    try {
      const snap = await getDoc(doc(db, 'public_profiles', uid));
      if (snap.exists()) {
        const name = snap.data()?.displayName;
        if (name) setNames((prev) => ({ ...prev, [uid]: name }));
      }
    } catch {
      // Non-fatal — we fall back to a generic label.
    }
  }, []);

  // Watch pair requests in both directions. Only equality filters, so these
  // need no composite index.
  useEffect(() => {
    if (!user) return;

    const toMe = query(collection(db, 'pair_requests'), where('to', '==', user.uid));
    const fromMe = query(collection(db, 'pair_requests'), where('from', '==', user.uid));

    const mapDocs = (snap: any): PairRequest[] =>
      snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as PairRequest[];

    const unsubTo = onSnapshot(
      toMe,
      (snap) => setIncoming(mapDocs(snap).filter((r) => r.status === 'pending')),
      (err) => console.error('Incoming pair request listener failed', err)
    );
    const unsubFrom = onSnapshot(
      fromMe,
      (snap) => setOutgoing(mapDocs(snap)),
      (err) => console.error('Outgoing pair request listener failed', err)
    );

    return () => {
      unsubTo();
      unsubFrom();
    };
  }, [user]);

  // Look up display names for everyone we're showing.
  useEffect(() => {
    const uids = new Set<string>();
    if (firstPartnerUid) uids.add(firstPartnerUid);
    incoming.forEach((r) => uids.add(r.from));
    outgoing.forEach((r) => uids.add(r.to));
    uids.forEach((uid) => {
      if (!names[uid]) void resolveName(uid);
    });
  }, [firstPartnerUid, incoming, outgoing, names, resolveName]);

  /**
   * Step 3 of the handshake: our request was accepted, so add the partner to
   * our own profile. Runs automatically — the invitee already consented.
   */
  useEffect(() => {
    if (!user || !profile) return;
    const accepted = outgoing.find(
      (r) => r.status === 'accepted' && !profile.partnerUids?.includes(r.to)
    );
    if (!accepted) return;

    (async () => {
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          isPaired: true,
          partnerUids: arrayUnion(accepted.to),
        });
        await deleteDoc(doc(db, 'pair_requests', accepted.id));
        toast.success(`You and ${names[accepted.to] ?? 'your partner'} are now connected.`);
      } catch (err) {
        console.error('Failed to complete pairing after acceptance', err);
      }
    })();
  }, [user, profile, outgoing, names]);

  const handleSendRequest = async () => {
    if (!user || !partnerCode || isLinking) return;
    const code = partnerCode.trim().toUpperCase();
    setLinkError(null);

    if (code.length !== 6) {
      setLinkError('Codes are 6 characters long. Double-check what your partner sent.');
      return;
    }
    if (profile?.connectionCode && code === profile.connectionCode) {
      setLinkError("That's your own code. Enter your partner's code, not yours.");
      return;
    }

    setIsLinking(true);
    try {
      // A direct get() on the code document. Codes are not queryable and the
      // collection is not listable, so knowing the code is the proof of consent.
      const codeSnap = await getDoc(doc(db, 'pairing_codes', code));
      if (!codeSnap.exists()) {
        setLinkError(
          "We couldn't find anyone with that code. Make sure your partner has signed in and that you've copied their full 6-character code."
        );
        return;
      }

      const partnerUid: string = codeSnap.data()?.uid;
      if (!partnerUid) {
        setLinkError('That code looks broken. Ask your partner to send it again.');
        return;
      }
      if (partnerUid === user.uid) {
        setLinkError("That's your own code. Enter your partner's code instead.");
        return;
      }
      if (profile?.partnerUids?.includes(partnerUid)) {
        setLinkError("You're already paired with this partner.");
        return;
      }

      // If they already asked us, accept instead of filing a mirror request.
      const theirRequest = incoming.find((r) => r.from === partnerUid);
      if (theirRequest) {
        await acceptRequest(theirRequest);
        setPartnerCode('');
        return;
      }

      // Deterministic id, so a repeat tap updates rather than piling up.
      const requestId = `${user.uid}_${partnerUid}`;
      await setDoc(doc(db, 'pair_requests', requestId), {
        from: user.uid,
        to: partnerUid,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });

      toast.success('Request sent. Your partner just needs to accept it.');
      setPartnerCode('');
    } catch (err: any) {
      console.error('Pairing request failed', err);
      setLinkError(
        "We couldn't send the pairing request. Ask your partner to sign in first, then try again. If this keeps happening, refresh the page."
      );
    } finally {
      setIsLinking(false);
    }
  };

  const acceptRequest = async (req: PairRequest) => {
    if (!user) return;
    setBusyRequestId(req.id);
    try {
      // Our half of the handshake: we write only our own profile.
      await updateDoc(doc(db, 'users', user.uid), {
        isPaired: true,
        partnerUids: arrayUnion(req.from),
      });
      // Tell the inviter they may now add us.
      await updateDoc(doc(db, 'pair_requests', req.id), {
        status: 'accepted',
        respondedAt: new Date().toISOString(),
      });
      toast.success(`You're connected with ${names[req.from] ?? 'your partner'}.`);
    } catch (err) {
      console.error('Failed to accept pair request', err);
      toast.error("We couldn't accept that request. Please refresh and try again.");
    } finally {
      setBusyRequestId(null);
    }
  };

  const declineRequest = async (req: PairRequest) => {
    setBusyRequestId(req.id);
    try {
      await updateDoc(doc(db, 'pair_requests', req.id), {
        status: 'declined',
        respondedAt: new Date().toISOString(),
      });
      toast.info('Request declined.');
    } catch (err) {
      console.error('Failed to decline pair request', err);
      toast.error("We couldn't decline that request. Please refresh and try again.");
    } finally {
      setBusyRequestId(null);
    }
  };

  const cancelRequest = async (req: PairRequest) => {
    setBusyRequestId(req.id);
    try {
      await deleteDoc(doc(db, 'pair_requests', req.id));
      toast.info('Request withdrawn.');
    } catch (err) {
      console.error('Failed to withdraw pair request', err);
      toast.error("We couldn't withdraw that request. Please refresh and try again.");
    } finally {
      setBusyRequestId(null);
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

  const codeBlock = (label: string) => (
    <div className="bg-white/10 p-4 rounded-2xl flex items-center justify-between border border-white/20">
      <div className="text-left">
        <p className="text-xs uppercase tracking-widest opacity-50 mb-1">{label}</p>
        <p className="text-2xl font-mono font-bold tracking-tighter">{profile?.connectionCode}</p>
      </div>
      <button
        onClick={copyCode}
        className="p-3 bg-sunset-gold text-oxblood rounded-xl hover:bg-sunset-gold/80 transition-colors"
        aria-label="Copy code"
      >
        {copied ? <Check size={20} /> : <Copy size={20} />}
      </button>
    </div>
  );

  const pendingRequests = incoming.map((req) => (
    <div
      key={req.id}
      className="bg-sunset-gold/10 border border-sunset-gold/30 rounded-2xl p-4 flex items-center justify-between gap-3"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 bg-sunset-gold/20 rounded-full flex items-center justify-center flex-shrink-0">
          <UserPlus className="text-sunset-gold" size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">{names[req.from] ?? 'Someone'} wants to pair</p>
          <p className="text-xs opacity-50">Only accept if you recognise them.</p>
        </div>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <button
          onClick={() => declineRequest(req)}
          disabled={busyRequestId === req.id}
          className="px-3 py-2 text-xs font-bold rounded-xl border border-white/20 hover:bg-white/10 disabled:opacity-50 transition-colors"
        >
          Decline
        </button>
        <button
          onClick={() => acceptRequest(req)}
          disabled={busyRequestId === req.id}
          className="px-4 py-2 text-xs font-bold rounded-xl bg-sunset-gold text-oxblood hover:bg-sunset-gold/90 disabled:opacity-50 transition-colors flex items-center gap-1"
        >
          {busyRequestId === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          Accept
        </button>
      </div>
    </div>
  ));

  const sentRequests = outgoing
    .filter((r) => r.status === 'pending')
    .map((req) => (
      <div
        key={req.id}
        className="bg-white/5 border border-white/10 rounded-2xl p-4 flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Clock className="opacity-40 flex-shrink-0" size={18} />
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">
              Waiting for {names[req.to] ?? 'your partner'} to accept
            </p>
            <p className="text-xs opacity-50">They'll see your request when they next open the app.</p>
          </div>
        </div>
        <button
          onClick={() => cancelRequest(req)}
          disabled={busyRequestId === req.id}
          className="px-3 py-2 text-xs font-bold rounded-xl border border-white/20 hover:bg-white/10 disabled:opacity-50 transition-colors flex-shrink-0"
        >
          Withdraw
        </button>
      </div>
    ));

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
          {names[firstPartnerUid] ? (
            <>You and <span className="font-bold text-sunset-gold">{names[firstPartnerUid]}</span> are paired.</>
          ) : (
            <>You're paired with your partner.</>
          )}{' '}
          Head over to the Library to start sharing your desires privately.
        </p>

        {incoming.length > 0 && <div className="space-y-3 mb-4 text-left">{pendingRequests}</div>}
        {sentRequests.length > 0 && <div className="space-y-3 mb-4 text-left">{sentRequests}</div>}

        <p className="text-xs opacity-50">
          Need to add another partner? Share your code below or enter a new one.
        </p>

        <div className="mt-6 mb-4">{codeBlock('Your Connection Code')}</div>
      </motion.div>
    );
  }

  // Not yet paired — show the handshake.
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-8 max-w-md mx-auto"
    >
      <h2 className="text-2xl font-serif mb-2 text-center">Pair with your partner</h2>
      <p className="text-sm opacity-70 mb-8 text-center">
        Both of you need a Yes Yas! account first. Then exchange codes — one of you sends a request,
        the other accepts it.
      </p>

      {(incoming.length > 0 || sentRequests.length > 0) && (
        <div className="space-y-3 mb-8">
          {pendingRequests}
          {sentRequests}
        </div>
      )}

      {/* STEP 1 */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-7 h-7 rounded-full bg-sunset-gold text-oxblood text-sm font-bold flex items-center justify-center">
            1
          </span>
          <h3 className="font-bold">Send your code to your partner</h3>
        </div>
        {codeBlock('Your code')}
        <p className="text-xs opacity-50 mt-2">
          Text or message it to them. Don't share this code with anyone else — it's what lets someone
          ask to pair with you.
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
            onClick={handleSendRequest}
            disabled={!partnerCode || isLinking}
            className="w-full py-4 bg-sunset-gold text-oxblood rounded-2xl font-bold shadow-lg hover:bg-sunset-gold/90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {isLinking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending request&hellip;
              </>
            ) : (
              'Send pairing request'
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
};

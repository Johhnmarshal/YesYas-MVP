import React, { useState } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { doc, setDoc, updateDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { useFirebase } from '../FirebaseProvider';
import { motion } from 'motion/react';
import { Copy, Check, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';

export const PairingFlow: React.FC = () => {
  const { user, profile } = useFirebase();
  const [partnerCode, setPartnerCode] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const handleCreateProfile = async () => {
    if (!user) return;
    const code = generateCode();
    try {
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        displayName: user.displayName,
        email: user.email,
        connectionCode: code,
        isPaired: false,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}`);
    }
  };

  const handleDemoMode = async () => {
    if (!user || !profile) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        isPaired: true,
        partnerUid: 'demo-partner-id'
      });
      toast.success("Demo mode activated! You are now 'paired'.");
    } catch (error) {
      toast.error("Failed to activate demo mode");
    }
  };

  const handleLinkPartner = async () => {
    if (!user || !partnerCode || isLinking) return;
    setIsLinking(true);
    try {
      const q = query(collection(db, 'users'), where('connectionCode', '==', partnerCode.trim().toUpperCase()));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        toast.error("Invalid partner code. Please check and try again.");
        return;
      }

      const partnerDoc = querySnapshot.docs[0];
      const partnerData = partnerDoc.data();

      if (partnerDoc.id === user.uid) {
        toast.error("You cannot pair with yourself!");
        return;
      }

      if (partnerData.isPaired) {
        toast.error("This partner is already paired with someone else.");
        return;
      }

      // Perform the pairing
      await updateDoc(doc(db, 'users', user.uid), {
        isPaired: true,
        partnerUid: partnerDoc.id
      });

      await updateDoc(doc(db, 'users', partnerDoc.id), {
        isPaired: true,
        partnerUid: user.uid
      });

      toast.success("Successfully connected with your partner!");
    } catch (error) {
      console.error(error);
      toast.error("Failed to link partner. You might not have permission to search for this code.");
    } finally {
      setIsLinking(false);
    }
  };

  const copyCode = () => {
    if (profile?.connectionCode) {
      navigator.clipboard.writeText(profile.connectionCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Code copied to clipboard!");
    }
  };

  if (!profile) {
    return (
      <div className="text-center py-20">
        <h2 className="text-3xl font-serif mb-6">Welcome to Yes Yas!</h2>
        <p className="mb-8 opacity-70">Let's start by creating your private profile.</p>
        <button 
          onClick={handleCreateProfile}
          className="px-8 py-3 bg-sunset-gold text-white rounded-full font-bold shadow-xl hover:scale-105 transition-transform"
        >
          Create My Profile
        </button>
      </div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card p-8 max-w-md mx-auto"
    >
      <h2 className="text-2xl font-serif mb-4 text-center">Connect with your Partner</h2>
      <p className="text-sm opacity-70 mb-8 text-center">
        Share your unique code with your partner to begin your journey together.
      </p>

      <div className="bg-white/10 p-4 rounded-2xl mb-8 flex items-center justify-between border border-white/20">
        <div>
          <p className="text-xs uppercase tracking-widest opacity-50 mb-1">Your Connection Code</p>
          <p className="text-2xl font-mono font-bold tracking-tighter">{profile.connectionCode}</p>
        </div>
        <button 
          onClick={copyCode}
          className="p-3 bg-sunset-gold text-oxblood rounded-xl hover:bg-sunset-gold/80 transition-colors"
        >
          {copied ? <Check size={20} /> : <Copy size={20} />}
        </button>
      </div>

      <div className="space-y-4">
        <div className="relative">
          <input 
            type="text" 
            value={partnerCode}
            onChange={(e) => setPartnerCode(e.target.value)}
            placeholder="Enter partner's code"
            className="w-full px-5 py-4 bg-white/10 border border-white/20 rounded-2xl focus:outline-none focus:ring-2 focus:ring-sunset-gold transition-all text-moonlit-cream placeholder-moonlit-cream/50"
          />
          <LinkIcon className="absolute right-4 top-4 opacity-20" />
        </div>
        <button 
          onClick={handleLinkPartner}
          disabled={!partnerCode || isLinking}
          className="w-full py-4 bg-sunset-gold text-oxblood rounded-2xl font-bold shadow-lg hover:bg-sunset-gold/90 disabled:opacity-50 transition-all"
        >
          {isLinking ? 'Linking...' : 'Connect Partner'}
        </button>

        <div className="pt-4 border-t border-white/20">
          <button 
            onClick={handleDemoMode}
            className="w-full py-3 bg-white/10 text-moonlit-cream rounded-2xl font-bold text-sm hover:bg-white/20 transition-all"
          >
            Skip for now (Demo Mode)
          </button>
        </div>
      </div>
    </motion.div>
  );
};

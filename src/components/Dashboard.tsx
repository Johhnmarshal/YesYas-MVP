import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { useFirebase } from '../FirebaseProvider';
import { motion } from 'motion/react';
import { Send, Lock, Unlock, MessageSquare, Sparkles, Heart } from 'lucide-react';
import { toast } from 'sonner';

export const Dashboard: React.FC = () => {
  const { user, profile } = useFirebase();
  const [journalEntries, setJournalEntries] = useState<any[]>([]);
  const [newEntry, setNewEntry] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);

  // In a real app, we'd calculate pairId correctly (sorted uids)
  const pairId = profile?.partnerUid ? [user?.uid, profile.partnerUid].sort().join('_') : 'demo_pair';

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, `pairs/${pairId}/journal`),
      orderBy('createdAt', 'desc')
    );
    
    const unsub = onSnapshot(q, (snapshot) => {
      const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setJournalEntries(entries);
    });
    
    return () => unsub();
  }, [user, pairId]);

  const handleSendEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newEntry.trim()) return;

    try {
      await addDoc(collection(db, `pairs/${pairId}/journal`), {
        authorId: user.uid,
        content: newEntry,
        isPrivate,
        createdAt: new Date().toISOString(),
        authorName: user.displayName
      });
      setNewEntry('');
      toast.success(isPrivate ? "Private note saved" : "Shared with partner");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `pairs/${pairId}/journal`);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div className="md:col-span-2 space-y-8">
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="text-sunset-gold" size={20} />
            <h2 className="text-xl font-serif">Mutual Discoveries</h2>
          </div>
          <div className="glass-card p-6 min-h-[150px] flex items-center justify-center text-center">
            <p className="opacity-40 italic">No mutual matches yet. Keep exploring the library!</p>
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="text-soft-sage" size={20} />
            <h2 className="text-xl font-serif">Shared Journal</h2>
          </div>
          
          <form onSubmit={handleSendEntry} className="mb-6 space-y-3">
            <textarea 
              value={newEntry}
              onChange={(e) => setNewEntry(e.target.value)}
              placeholder="What's on your mind? Share a thought or a feeling..."
              className="w-full p-4 bg-white/50 border border-white/30 rounded-2xl focus:outline-none focus:ring-2 focus:ring-soft-sage min-h-[100px] resize-none"
            />
            <div className="flex justify-between items-center">
              <button 
                type="button"
                onClick={() => setIsPrivate(!isPrivate)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all ${isPrivate ? 'bg-deep-plum text-white' : 'bg-white/50 text-deep-plum opacity-60'}`}
              >
                {isPrivate ? <Lock size={14} /> : <Unlock size={14} />}
                {isPrivate ? 'Private Note' : 'Shared with Partner'}
              </button>
              <button 
                type="submit"
                disabled={!newEntry.trim()}
                className="px-6 py-2 bg-soft-sage text-deep-plum font-bold rounded-full shadow-md hover:bg-soft-sage/80 disabled:opacity-50 transition-all flex items-center gap-2"
              >
                <Send size={16} />
                Send
              </button>
            </div>
          </form>

          <div className="space-y-4">
            {journalEntries.map((entry) => (
              <motion.div 
                key={entry.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={`p-4 rounded-2xl ${entry.authorId === user?.uid ? 'bg-white/60 ml-8 border-r-4 border-soft-sage' : 'bg-white/30 mr-8 border-l-4 border-sunset-gold'}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">
                    {entry.authorId === user?.uid ? 'You' : entry.authorName}
                  </span>
                  {entry.isPrivate && <Lock size={10} className="opacity-30" />}
                </div>
                <p className="text-sm leading-relaxed">{entry.content}</p>
              </motion.div>
            ))}
          </div>
        </section>
      </div>

      <div className="space-y-6">
        <div className="glass-card p-6">
          <h3 className="font-serif mb-4">Partner Status</h3>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-soft-sage/30 rounded-full flex items-center justify-center">
              <Heart className="text-soft-sage fill-current" size={24} />
            </div>
            <div>
              <p className="text-sm font-bold">Waiting for partner...</p>
              <p className="text-xs opacity-50">Share your code to pair</p>
            </div>
          </div>
        </div>

        <div className="bg-sunset-gold/10 p-6 rounded-3xl border border-sunset-gold/20">
          <h3 className="font-serif mb-2 text-sunset-gold">Daily Prompt</h3>
          <p className="text-sm italic opacity-80">"What is one thing your partner did this week that made you feel truly seen?"</p>
        </div>
      </div>
    </div>
  );
};

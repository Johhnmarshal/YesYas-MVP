import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, doc, setDoc, onSnapshot, query, where } from 'firebase/firestore';
import { useFirebase } from '../FirebaseProvider';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, Star, X, Info, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

const MOCK_DESIRES = [
  { id: '1', title: 'Stargazing Picnic', description: 'A quiet night under the stars with snacks and blankets.', category: 'Emotional' },
  { id: '2', title: 'Weekend Getaway', description: 'A surprise trip to a nearby cozy cabin.', category: 'Adventurous' },
  { id: '3', title: 'Slow Dancing', description: 'Dancing in the living room to our favorite songs.', category: 'Sensual' },
  { id: '4', title: 'Deep Conversation', description: 'Spending an hour asking each other deep questions.', category: 'Emotional' },
  { id: '5', title: 'Cooking Together', description: 'Trying a complex new recipe from scratch.', category: 'Physical' },
];

export const DesireLibrary: React.FC = () => {
  const { user } = useFirebase();
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, `users/${user.uid}/preferences`), (snapshot) => {
      const prefs: Record<string, string> = {};
      snapshot.docs.forEach(doc => {
        prefs[doc.id] = doc.data().preference;
      });
      setPreferences(prefs);
    });
    return () => unsub();
  }, [user]);

  const handlePreference = async (desireId: string, preference: 'Yes' | 'Maybe' | 'No') => {
    if (!user) return;
    try {
      await setDoc(doc(db, `users/${user.uid}/preferences`, desireId), {
        userId: user.uid,
        desireId,
        preference,
        updatedAt: new Date().toISOString()
      });
      
      if (preference === 'Yes') {
        toast.success("Added to your private list!");
      }
      
      if (currentIndex < MOCK_DESIRES.length - 1) {
        setCurrentIndex(prev => prev + 1);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/preferences/${desireId}`);
    }
  };

  const currentDesire = MOCK_DESIRES[currentIndex];
  const hasPreference = preferences[currentDesire?.id];

  return (
    <div className="max-w-md mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-serif">Desire Library</h2>
        <span className="text-xs font-mono opacity-40">{currentIndex + 1} / {MOCK_DESIRES.length}</span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={currentDesire?.id}
          initial={{ opacity: 0, scale: 0.9, x: 20 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          exit={{ opacity: 0, scale: 1.1, x: -20 }}
          className="glass-card p-8 min-h-[400px] flex flex-col justify-between relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Heart size={120} className="fill-current" />
          </div>

          <div>
            <span className="px-3 py-1 bg-sunset-gold/20 text-sunset-gold text-xs font-bold rounded-full uppercase tracking-widest mb-4 inline-block">
              {currentDesire?.category}
            </span>
            <h3 className="text-3xl font-serif mb-4 leading-tight">{currentDesire?.title}</h3>
            <p className="opacity-70 leading-relaxed">{currentDesire?.description}</p>
          </div>

          <div className="flex gap-4 mt-8">
            <button 
              onClick={() => handlePreference(currentDesire.id, 'No')}
              className="flex-1 py-4 rounded-2xl border border-white/10 hover:bg-white/5 transition-colors flex flex-col items-center gap-1"
            >
              <X className="text-red-400" />
              <span className="text-xs font-bold opacity-40">Not now</span>
            </button>
            <button 
              onClick={() => handlePreference(currentDesire.id, 'Maybe')}
              className="flex-1 py-4 rounded-2xl border border-white/10 hover:bg-sunset-gold/10 transition-colors flex flex-col items-center gap-1"
            >
              <Star className="text-sunset-gold" />
              <span className="text-xs font-bold opacity-40">Maybe</span>
            </button>
            <button 
              onClick={() => handlePreference(currentDesire.id, 'Yes')}
              className="flex-1 py-4 bg-sunset-gold text-oxblood rounded-2xl shadow-lg hover:bg-sunset-gold/90 transition-all flex flex-col items-center gap-1"
            >
              <Heart className="fill-current" />
              <span className="text-xs font-bold opacity-60">Yes!</span>
            </button>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="mt-8 flex justify-center gap-2">
        {MOCK_DESIRES.map((_, i) => (
          <div 
            key={i} 
            className={`h-1 rounded-full transition-all ${i === currentIndex ? 'w-8 bg-sunset-gold' : 'w-2 bg-white/20'}`}
          />
        ))}
      </div>
    </div>
  );
};

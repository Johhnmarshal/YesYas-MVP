import { Layout } from './components/Layout';
import { useFirebase } from './FirebaseProvider';
import { PairingFlow } from './components/PairingFlow';
import { DesireLibrary } from './components/DesireLibrary';
import { Dashboard } from './components/Dashboard';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Library, LayoutDashboard, Heart, LogIn, Loader2 } from 'lucide-react';
import { auth, googleProvider } from './firebase';
import { signInWithPopup } from 'firebase/auth';
import { toast } from 'sonner';

export default function App() {
  const { user, profile, loading } = useFirebase();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'library' | 'pairing'>('dashboard');
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
      // The FirebaseProvider will pick up the new user and auto-create a profile.
    } catch (err: any) {
      // Pop-ups can be blocked, closed, or fail silently. Tell the tester.
      const code = err?.code ?? '';
      if (code === 'auth/popup-blocked') {
        toast.error("Your browser blocked the sign-in pop-up. Please allow pop-ups for this site and try again.");
      } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        toast.info("Sign-in cancelled. Tap the button again when you're ready.");
      } else {
        toast.error("Sign-in failed. Please try again, or use a different browser if this keeps happening.");
        console.error('Sign-in error', err);
      }
    } finally {
      setSigningIn(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen nature-gradient flex items-center justify-center">
        <motion.div
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          <Heart className="text-sunset-gold w-12 h-12 fill-current" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <Layout>
        <div className="text-center py-16">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl font-serif mb-6 text-moonlit-cream"
          >
            Reconnect with <br /> <span className="text-sunset-gold italic">Intention</span>
          </motion.h2>
          <p className="text-lg opacity-60 mb-10 max-w-lg mx-auto leading-relaxed">
            Yes Yas! is a safe space for couples to explore desires,
            share thoughts, and build a deeper emotional connection.
          </p>

          <motion.button
            onClick={handleSignIn}
            disabled={signingIn}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="inline-flex items-center gap-3 px-8 py-4 bg-sunset-gold text-oxblood rounded-full font-bold shadow-xl hover:scale-105 disabled:opacity-60 disabled:hover:scale-100 transition-transform"
          >
            {signingIn ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Opening sign-in&hellip;
              </>
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                Sign in with Google to begin
              </>
            )}
          </motion.button>

          <p className="text-xs opacity-50 mt-6 max-w-sm mx-auto">
            You'll need to sign in before you can pair with your partner. Both of you should sign in on your own devices.
          </p>

          <div className="flex justify-center gap-4 mt-12">
            <div className="w-4 h-4 bg-sunset-gold rounded-full" />
            <div className="w-4 h-4 bg-soft-sage rounded-full" />
            <div className="w-4 h-4 bg-deep-plum rounded-full" />
          </div>
        </div>
      </Layout>
    );
  }

  if (!profile || (!profile.isPaired && activeTab !== 'pairing')) {
    return (
      <Layout>
        <PairingFlow />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col gap-8">
        <nav className="flex justify-center">
          <div className="bg-white/40 backdrop-blur-sm p-1 rounded-full flex gap-1 border border-white/20 shadow-sm">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-2 px-6 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'dashboard' ? 'bg-sunset-gold text-oxblood shadow-md' : 'hover:bg-white/10 opacity-60'}`}
            >
              <LayoutDashboard size={16} />
              Dashboard
            </button>
            <button 
              onClick={() => setActiveTab('library')}
              className={`flex items-center gap-2 px-6 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'library' ? 'bg-sunset-gold text-oxblood shadow-md' : 'hover:bg-white/10 opacity-60'}`}
            >
              <Library size={16} />
              Library
            </button>
            <button 
              onClick={() => setActiveTab('pairing')}
              className={`flex items-center gap-2 px-6 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'pairing' ? 'bg-sunset-gold text-oxblood shadow-md' : 'hover:bg-white/10 opacity-60'}`}
            >
              <Heart size={16} />
              Pairing
            </button>
          </div>
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'dashboard' && <Dashboard />}
            {activeTab === 'library' && <DesireLibrary />}
            {activeTab === 'pairing' && <PairingFlow />}
          </motion.div>
        </AnimatePresence>
      </div>
    </Layout>
  );
}

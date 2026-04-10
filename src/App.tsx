import { Layout } from './components/Layout';
import { useFirebase } from './FirebaseProvider';
import { PairingFlow } from './components/PairingFlow';
import { DesireLibrary } from './components/DesireLibrary';
import { Dashboard } from './components/Dashboard';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Library, LayoutDashboard, Heart } from 'lucide-react';

export default function App() {
  const { user, profile, loading } = useFirebase();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'library' | 'pairing'>('dashboard');

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
        <div className="text-center py-20">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl font-serif mb-6 text-moonlit-cream"
          >
            Reconnect with <br /> <span className="text-sunset-gold italic">Intention</span>
          </motion.h2>
          <p className="text-lg opacity-60 mb-12 max-w-lg mx-auto leading-relaxed">
            Yes Yas! is a safe space for couples to explore desires, 
            share thoughts, and build a deeper emotional connection.
          </p>
          <div className="flex justify-center gap-4">
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

import React from 'react';
import { useFirebase } from '../FirebaseProvider';
import { auth, googleProvider } from '../firebase';
import { signInWithPopup, signOut } from 'firebase/auth';
import { LogOut, Heart, Moon, Sun, User as UserIcon } from 'lucide-react';
import { motion } from 'motion/react';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile } = useFirebase();

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = () => signOut(auth);

  return (
    <div className="min-h-screen flex flex-col nature-gradient">
      <header className="p-6 flex justify-between items-center">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2"
        >
          <div className="w-10 h-10 bg-sunset-gold rounded-full flex items-center justify-center shadow-lg">
            <Heart className="text-white w-6 h-6 fill-current" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-deep-plum tracking-tight">Yes Yas!</h1>
        </motion.div>

        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium">{profile?.displayName || user.displayName}</p>
                <p className="text-xs opacity-60">{profile?.isPaired ? 'Paired' : 'Single'}</p>
              </div>
              <button 
                onClick={handleLogout}
                className="p-2 hover:bg-white/20 rounded-full transition-colors"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="px-6 py-2 bg-deep-plum text-white rounded-full font-medium shadow-lg hover:bg-deep-plum/90 transition-all active:scale-95"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 container mx-auto px-6 py-8 max-w-4xl">
        {children}
      </main>

      <footer className="p-8 text-center text-sm opacity-40 font-serif italic">
        "Your curiosity is beautiful"
      </footer>
    </div>
  );
};

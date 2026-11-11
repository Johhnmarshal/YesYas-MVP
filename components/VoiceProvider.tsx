import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { supabase } from '@/lib/supabase';
import { DEFAULT_TONE, type Voice, type VoiceTone, voiceFor } from '@/lib/voice';

interface VoiceContextValue {
  tone: VoiceTone;
  voice: Voice;
  /** Call after saving a new tone so every screen changes voice at once. */
  setTone: (tone: VoiceTone) => void;
}

const VoiceContext = createContext<VoiceContextValue>({
  tone: DEFAULT_TONE,
  voice: voiceFor(DEFAULT_TONE),
  setTone: () => undefined,
});

/**
 * Loads the signed-in person's tone once for the whole (app) group. Until it
 * arrives, and if it cannot be read, the gentle romantic voice is used: the
 * safe default for someone who has not said they want it franker.
 */
export function VoiceProvider({ children }: PropsWithChildren) {
  const [tone, setToneState] = useState<VoiceTone>(DEFAULT_TONE);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('profiles')
          .select('tone_preference')
          .eq('id', user.id)
          .maybeSingle();
        const next = data?.tone_preference;
        if (!cancelled && (next === 'romantic' || next === 'playful' || next === 'direct')) {
          setToneState(next);
        }
      } catch {
        // Keep the default voice.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setTone = useCallback((next: VoiceTone) => setToneState(next), []);
  const value = useMemo(() => ({ tone, voice: voiceFor(tone), setTone }), [tone, setTone]);

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceContextValue {
  return useContext(VoiceContext);
}

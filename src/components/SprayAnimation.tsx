import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pause, Play, Loader2 } from "lucide-react";
import { SprayAvatarCharacter } from "@/components/SprayAvatarCharacter";
import { SprayMoneyBill } from "@/components/SprayMoneyBill";
import type { AvatarData } from "@/types/avatar";
import { DEFAULT_AVATAR_DATA } from "@/types/avatar";

interface SprayAnimationProps {
  isActive: boolean;
  amount: number;
  denomination: number;
  noteIntervalSec?: number;
  sessionDurationSec?: number;
  avatarData?: AvatarData;
  onComplete: (sprayedAmount: number) => Promise<void>;
  onAutoStop: () => Promise<void>;
  onCancel: (sprayedAmount: number) => Promise<void>;
  eventName: string;
}

interface MoneyNote {
  id: number;
  x: number;
  rotation: number;
  scale: number;
}

export const SprayAnimation = ({
  isActive,
  amount,
  denomination,
  noteIntervalSec = 1,
  sessionDurationSec,
  avatarData = DEFAULT_AVATAR_DATA,
  onComplete,
  onAutoStop,
  onCancel,
  eventName: _eventName,
}: SprayAnimationProps) => {
  const effectiveSessionSec = sessionDurationSec ?? Math.min(amount / denomination, 180);

  const [sprayedAmount, setSprayedAmount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [notes, setNotes] = useState<MoneyNote[]>([]);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationAmount, setCelebrationAmount] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [counterPulse, setCounterPulse] = useState(false);
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState(effectiveSessionSec);
  const noteIdRef = useRef(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const sessionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sessionDeadlineRef = useRef<number | null>(null);
  const sessionRemainingMsRef = useRef(effectiveSessionSec * 1000);
  const recordingRef = useRef(false);
  const prevAmountRef = useRef(0);

  const progress = amount > 0 ? (sprayedAmount / amount) * 100 : 0;

  const resetLocal = useCallback(() => {
    setSprayedAmount(0);
    setNotes([]);
    setShowCelebration(false);
    setCelebrationAmount(0);
    setIsRecording(false);
    setIsPaused(false);
    setSessionSecondsLeft(effectiveSessionSec);
    recordingRef.current = false;
    prevAmountRef.current = 0;
    sessionDeadlineRef.current = null;
    sessionRemainingMsRef.current = effectiveSessionSec * 1000;
  }, [effectiveSessionSec]);

  const clearSessionTimer = useCallback(() => {
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
  }, []);

  const finalizeRecording = useCallback(
    async (mode: "complete" | "auto" | "cancel", currentSprayed: number) => {
      if (recordingRef.current) return;
      recordingRef.current = true;
      setIsRecording(true);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      clearSessionTimer();

      try {
        if (mode === "complete") {
          await onComplete(currentSprayed);
          setCelebrationAmount(amount);
        } else if (mode === "auto") {
          await onAutoStop();
          setCelebrationAmount(amount);
        } else {
          await onCancel(currentSprayed);
        }
        if (mode === "complete" || mode === "auto") {
          setShowCelebration(true);
        }
      } catch {
        recordingRef.current = false;
        setIsRecording(false);
        return;
      }

      if (mode === "cancel") {
        resetLocal();
        return;
      }

      window.setTimeout(() => {
        resetLocal();
      }, 2000);
    },
    [amount, clearSessionTimer, onAutoStop, onCancel, onComplete, resetLocal],
  );

  useEffect(() => {
    if (sprayedAmount > prevAmountRef.current) {
      setCounterPulse(true);
      const t = window.setTimeout(() => setCounterPulse(false), 280);
      prevAmountRef.current = sprayedAmount;
      return () => window.clearTimeout(t);
    }
    prevAmountRef.current = sprayedAmount;
  }, [sprayedAmount]);

  useEffect(() => {
    if (!isActive || isPaused || isRecording) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setSprayedAmount((prev) => {
        if (prev >= amount) return prev;
        const newNote: MoneyNote = {
          id: noteIdRef.current++,
          x: Math.random() * 280 - 140,
          rotation: Math.random() * 360 - 180,
          scale: 0.85 + Math.random() * 0.35,
        };
        setNotes((notePrev) => [...notePrev.slice(-24), newNote]);
        return Math.min(prev + denomination, amount);
      });
    }, Math.max(noteIntervalSec * 1000, 50));

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, isPaused, isRecording, amount, denomination, noteIntervalSec]);

  useEffect(() => {
    if (sprayedAmount < amount || !isActive || recordingRef.current) return;
    void finalizeRecording("complete", sprayedAmount);
  }, [sprayedAmount, amount, isActive, finalizeRecording]);

  useEffect(() => {
    if (!isActive || isRecording) {
      clearSessionTimer();
      return;
    }

    if (isPaused) {
      if (sessionDeadlineRef.current != null) {
        sessionRemainingMsRef.current = Math.max(0, sessionDeadlineRef.current - Date.now());
        sessionDeadlineRef.current = null;
      }
      clearSessionTimer();
      return;
    }

    if (sessionDeadlineRef.current == null) {
      sessionDeadlineRef.current = Date.now() + sessionRemainingMsRef.current;
    }

    sessionTimerRef.current = setInterval(() => {
      if (sessionDeadlineRef.current == null) return;
      const remainingMs = Math.max(0, sessionDeadlineRef.current - Date.now());
      setSessionSecondsLeft(Math.ceil(remainingMs / 1000));
      if (remainingMs <= 0 && !recordingRef.current) {
        void finalizeRecording("auto", sprayedAmount);
      }
    }, 200);

    return () => clearSessionTimer();
  }, [isActive, isPaused, isRecording, clearSessionTimer, finalizeRecording, sprayedAmount]);

  useEffect(() => {
    if (!isActive) resetLocal();
  }, [isActive, resetLocal]);

  const handleStop = () => {
    if (recordingRef.current) return;
    void finalizeRecording("cancel", sprayedAmount);
  };

  if (!isActive) return null;

  const controlsLocked = isRecording;
  const showStopHint = !controlsLocked;

  return (
    <motion.div
      className="fixed inset-0 z-[100] overflow-hidden bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="pointer-events-none absolute inset-0 spray-scene-dim opacity-50">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,hsl(43_96%_56%/0.12),transparent_55%)]" />
        <div className="absolute inset-0 flex items-center justify-center pt-8">
          <AnimatePresence>
            {notes.map((note) => (
              <motion.div
                key={note.id}
                className="absolute"
                initial={{ y: 80, x: 0, opacity: 0.9, scale: 0, rotate: 0 }}
                animate={{
                  y: -320 - Math.random() * 120,
                  x: note.x,
                  opacity: 0,
                  scale: note.scale,
                  rotate: note.rotation,
                }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.6 + Math.random() * 0.5, ease: "easeOut" }}
                style={{ bottom: "38%" }}
              >
                <SprayMoneyBill denomination={denomination} size="md" />
              </motion.div>
            ))}
          </AnimatePresence>

          <motion.div
            animate={!isPaused && !isRecording ? { y: [0, -8, 0], rotate: [-3, 3, -3] } : { scale: 0.96 }}
            transition={{ duration: 0.55, repeat: Infinity, ease: "easeInOut" }}
          >
            <SprayAvatarCharacter
              avatar={avatarData}
              size="hero"
              dancing={!isPaused && !isRecording}
              danceStyle="spray"
              showGlow
            />
          </motion.div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-black/55 to-black/90" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[42%] bg-gradient-to-t from-black via-black/80 to-transparent" />

      <AnimatePresence>
        {showCelebration && (
          <motion.div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} className="text-center px-6">
              <p className="text-7xl mb-4">🎉</p>
              <h2 className="text-3xl font-black text-gradient-gold spray-counter-neon">Spray sent!</h2>
              <p className="text-2xl font-bold text-white mt-3">₦{celebrationAmount.toLocaleString()}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {isRecording && !showCelebration && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75">
          <div className="text-center">
            <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-primary" />
            <p className="text-lg font-semibold text-white">Locking in your spray…</p>
          </div>
        </div>
      )}

      <div className="relative z-20 flex h-full flex-col items-center justify-between px-6 pb-12 pt-16">
        <div className="flex flex-col items-center text-center">
          <motion.p
            className="mb-2 text-xs font-bold uppercase tracking-[0.45em] text-white/45"
            animate={!isPaused && !isRecording ? { opacity: [0.35, 0.7, 0.35] } : { opacity: 0.5 }}
            transition={{ duration: 1.8, repeat: Infinity }}
          >
            {isPaused ? "Paused" : "Spraying"}
          </motion.p>

          <motion.p
            key={sprayedAmount}
            className={`text-6xl font-black tabular-nums text-gradient-gold spray-counter-neon md:text-8xl ${
              counterPulse ? "scale-110" : "scale-100"
            } transition-transform duration-200`}
          >
            ₦{sprayedAmount.toLocaleString()}
          </motion.p>

          <p className="mt-2 text-xs font-medium text-white/40 tabular-nums">
            Session {sessionSecondsLeft}s · Full ₦{amount.toLocaleString()} reserved
          </p>

          <div className="mt-5 h-1.5 w-48 overflow-hidden rounded-full bg-white/10 md:w-56">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-primary via-yellow-300 to-primary"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              style={{ boxShadow: "0 0 16px hsl(43 96% 56% / 0.65)" }}
            />
          </div>
        </div>

        <div className="w-full max-w-lg space-y-4">
          {showStopHint && (
            <p className="text-center text-xs font-medium text-white/50">
              Stop keeps ₦{sprayedAmount.toLocaleString()} · Timer charges full ₦{amount.toLocaleString()}
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <motion.button
              type="button"
              disabled={controlsLocked}
              onClick={() => setIsPaused((p) => !p)}
              className={`flex min-h-[4.5rem] flex-col items-center justify-center rounded-2xl px-4 py-4 text-center font-black uppercase tracking-wide text-cyan-300 transition-transform active:scale-[0.97] disabled:opacity-40 spray-neon-pause ${
                isPaused ? "spray-neon-pause-active" : ""
              }`}
              whileTap={{ scale: 0.97 }}
            >
              {isPaused ? (
                <>
                  <Play className="mb-1 h-8 w-8" strokeWidth={2.5} />
                  <span className="text-lg md:text-xl">Resume</span>
                </>
              ) : (
                <>
                  <Pause className="mb-1 h-8 w-8" strokeWidth={2.5} />
                  <span className="text-lg md:text-xl">Pause</span>
                </>
              )}
            </motion.button>

            <motion.button
              type="button"
              disabled={controlsLocked}
              onClick={handleStop}
              className={`flex min-h-[4.5rem] flex-col items-center justify-center rounded-2xl px-4 py-4 text-center font-black uppercase tracking-wide text-red-300 transition-transform active:scale-[0.97] disabled:opacity-40 spray-neon-stop ${
                !isPaused && !controlsLocked ? "spray-neon-stop-idle" : ""
              }`}
              whileTap={{ scale: 0.97 }}
            >
              <SquareStopIcon />
              <span className="mt-1 text-lg md:text-xl">Stop</span>
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

function SquareStopIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 fill-current" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

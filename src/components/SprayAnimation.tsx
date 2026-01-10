import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import heroAvatar from "@/assets/hero-avatar.png";

interface SprayAnimationProps {
  isActive: boolean;
  amount: number;
  denomination: number;
  onComplete: (sprayedAmount: number) => void;
  onCancel: (sprayedAmount: number) => void;
  eventName: string;
}

interface MoneyNote {
  id: number;
  x: number;
  rotation: number;
  delay: number;
  scale: number;
}

export const SprayAnimation = ({
  isActive,
  amount,
  denomination,
  onComplete,
  onCancel,
  eventName,
}: SprayAnimationProps) => {
  const [sprayedAmount, setSprayedAmount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [notes, setNotes] = useState<MoneyNote[]>([]);
  const [showCelebration, setShowCelebration] = useState(false);
  const noteIdRef = useRef(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const totalNotes = Math.floor(amount / denomination);
  const progress = (sprayedAmount / amount) * 100;

  const sprayNote = useCallback(() => {
    if (sprayedAmount >= amount) return;

    // Create new note
    const newNote: MoneyNote = {
      id: noteIdRef.current++,
      x: Math.random() * 200 - 100,
      rotation: Math.random() * 360 - 180,
      delay: 0,
      scale: 0.8 + Math.random() * 0.4,
    };

    setNotes((prev) => [...prev.slice(-20), newNote]); // Keep last 20 notes
    setSprayedAmount((prev) => Math.min(prev + denomination, amount));
  }, [sprayedAmount, amount, denomination]);

  useEffect(() => {
    if (!isActive || isPaused) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Spray 1 note per second
    intervalRef.current = setInterval(() => {
      if (sprayedAmount < amount) {
        sprayNote();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isActive, isPaused, sprayNote, sprayedAmount, amount]);

  useEffect(() => {
    if (sprayedAmount >= amount && isActive) {
      setShowCelebration(true);
      setTimeout(() => {
        onComplete(sprayedAmount);
        setSprayedAmount(0);
        setNotes([]);
        setShowCelebration(false);
      }, 2000);
    }
  }, [sprayedAmount, amount, isActive, onComplete]);

  const handleCancel = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    onCancel(sprayedAmount);
    setSprayedAmount(0);
    setNotes([]);
    setIsPaused(false);
  };

  const getDenominationEmoji = () => {
    switch (denomination) {
      case 200: return "💵";
      case 500: return "💴";
      case 1000: return "💰";
      default: return "💵";
    }
  };

  if (!isActive) return null;

  return (
    <motion.div
      className="fixed inset-0 z-[100] bg-background"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/20 via-background to-background" />

      {/* Celebration overlay */}
      <AnimatePresence>
        {showCelebration && (
          <motion.div
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="text-center"
            >
              <motion.div
                className="text-8xl mb-4"
                animate={{ 
                  rotate: [0, 10, -10, 10, 0],
                  scale: [1, 1.2, 1],
                }}
                transition={{ duration: 0.5, repeat: 3 }}
              >
                🎉
              </motion.div>
              <h2 className="text-3xl font-black text-primary">Spray Complete!</h2>
              <p className="text-xl text-foreground mt-2">
                You sprayed ₦{amount.toLocaleString()}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-12 pb-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Spraying 💸</h2>
          <p className="text-sm text-muted-foreground">{eventName}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-6 h-6" />
        </Button>
      </div>

      {/* Stats bar */}
      <div className="relative z-10 px-6 mb-8">
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm text-muted-foreground">Sprayed</p>
              <p className="text-2xl font-black text-primary">
                ₦{sprayedAmount.toLocaleString()}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Remaining</p>
              <p className="text-2xl font-bold text-foreground">
                ₦{(amount - sprayedAmount).toLocaleString()}
              </p>
            </div>
          </div>
          
          {/* Progress bar */}
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          
          <div className="flex items-center justify-between mt-2 text-sm text-muted-foreground">
            <span>{Math.floor(sprayedAmount / denomination)} / {totalNotes} notes</span>
            <span>{denomination === 1000 ? "₦1K" : `₦${denomination}`} each</span>
          </div>
        </div>
      </div>

      {/* Avatar and spray area */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6">
        {/* Money notes animation */}
        <div className="relative w-full h-64 flex items-end justify-center overflow-hidden">
          <AnimatePresence>
            {notes.map((note) => (
              <motion.div
                key={note.id}
                className="absolute text-4xl"
                initial={{ 
                  y: 0, 
                  x: 0, 
                  opacity: 1, 
                  scale: 0,
                  rotate: 0 
                }}
                animate={{ 
                  y: -300 - Math.random() * 100, 
                  x: note.x, 
                  opacity: 0,
                  scale: note.scale,
                  rotate: note.rotation,
                }}
                exit={{ opacity: 0 }}
                transition={{ 
                  duration: 1.5 + Math.random() * 0.5,
                  ease: "easeOut",
                }}
                style={{ bottom: 80 }}
              >
                {getDenominationEmoji()}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Avatar */}
          <motion.div
            className="relative z-10"
            animate={!isPaused ? { 
              y: [0, -5, 0],
              rotate: [-2, 2, -2],
            } : {}}
            transition={{ 
              duration: 0.5, 
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <motion.div
              className="w-32 h-32 rounded-full overflow-hidden border-4 border-primary shadow-lg"
              style={{ boxShadow: "0 0 40px hsl(43 96% 56% / 0.5)" }}
            >
              <img 
                src={heroAvatar} 
                alt="Your avatar" 
                className="w-full h-full object-cover"
              />
            </motion.div>
            
            {/* Spray effect from hands */}
            {!isPaused && (
              <>
                <motion.div
                  className="absolute -left-8 top-1/2 text-2xl"
                  animate={{ 
                    y: [-10, 10, -10],
                    rotate: [-20, 0, -20],
                    scale: [1, 1.2, 1],
                  }}
                  transition={{ duration: 0.3, repeat: Infinity }}
                >
                  🤚
                </motion.div>
                <motion.div
                  className="absolute -right-8 top-1/2 text-2xl"
                  animate={{ 
                    y: [10, -10, 10],
                    rotate: [20, 0, 20],
                    scale: [1, 1.2, 1],
                  }}
                  transition={{ duration: 0.3, repeat: Infinity }}
                >
                  🤚
                </motion.div>
              </>
            )}
          </motion.div>
        </div>

        {/* Current spray indicator */}
        <motion.div
          className="mt-8 text-center"
          animate={!isPaused ? { scale: [1, 1.05, 1] } : {}}
          transition={{ duration: 1, repeat: Infinity }}
        >
          <p className="text-6xl mb-2">{getDenominationEmoji()}</p>
          <p className="text-lg font-bold text-foreground">
            ₦{denomination.toLocaleString()} per note
          </p>
        </motion.div>
      </div>

      {/* Controls */}
      <div className="relative z-10 px-6 pb-12">
        <div className="flex gap-4">
          <Button
            variant={isPaused ? "gold" : "outline"}
            size="lg"
            className="flex-1"
            onClick={() => setIsPaused(!isPaused)}
          >
            {isPaused ? (
              <>
                <Play className="w-5 h-5 mr-2" />
                Resume
              </>
            ) : (
              <>
                <Pause className="w-5 h-5 mr-2" />
                Pause
              </>
            )}
          </Button>
          <Button
            variant="destructive"
            size="lg"
            className="flex-1"
            onClick={handleCancel}
          >
            Stop Spray
          </Button>
        </div>
        {sprayedAmount > 0 && (
          <p className="text-center text-sm text-muted-foreground mt-3">
            ⚠️ Stopping will keep ₦{sprayedAmount.toLocaleString()} already sprayed
          </p>
        )}
      </div>
    </motion.div>
  );
};

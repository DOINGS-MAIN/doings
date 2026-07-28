import { motion } from "framer-motion";
import { Maximize2, X } from "lucide-react";
import QRCode from "react-qr-code";
import type { EventData } from "@/hooks/useEvents";
import { SprayAvatarCharacter } from "@/components/SprayAvatarCharacter";

interface EventScreenIdleViewProps {
  event: EventData;
  joinLink: string;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onBack: () => void;
}

/** Projector waiting room — one avatar + join QR, nothing else. */
export function EventScreenIdleView({
  event,
  joinLink,
  isFullscreen,
  onToggleFullscreen,
  onBack,
}: EventScreenIdleViewProps) {
  return (
    <div className="relative flex min-h-dvh max-h-dvh flex-col overflow-hidden bg-black">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,hsl(43_96%_56%/0.14),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/80" />

      <div className="relative z-10 flex shrink-0 items-center justify-between px-5 py-4 md:px-8">
        <div className="min-w-0">
          <p className="truncate text-lg font-black text-white md:text-2xl">{event.title}</p>
          <p className="mt-0.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-green-400 md:text-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            Live
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <motion.button
            type="button"
            onClick={onToggleFullscreen}
            className="rounded-xl bg-white/10 p-2.5 text-white backdrop-blur transition-colors hover:bg-white/15"
            whileTap={{ scale: 0.95 }}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            <Maximize2 className="h-5 w-5" />
          </motion.button>
          <motion.button
            type="button"
            onClick={onBack}
            className="rounded-xl bg-white/10 p-2.5 text-white backdrop-blur transition-colors hover:bg-white/15"
            whileTap={{ scale: 0.95 }}
            aria-label="Close event screen"
          >
            <X className="h-5 w-5" />
          </motion.button>
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6 pb-10 md:flex-row md:gap-16 md:px-12">
        <motion.div
          className="flex flex-col items-center text-center"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <motion.div
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <SprayAvatarCharacter size="hero" dancing danceStyle="sway" showGlow />
          </motion.div>
          <p className="mt-6 text-xl font-bold text-white md:text-2xl">Waiting for sprayers</p>
          <p className="mt-2 max-w-xs text-sm text-white/55 md:text-base">
            Be the first to spray — or scan the code to join from your phone.
          </p>
          {event.totalSprayed > 0 && (
            <p className="mt-4 text-sm font-semibold text-primary">
              ₦{event.totalSprayed.toLocaleString()} sprayed so far
            </p>
          )}
        </motion.div>

        <motion.div
          className="flex flex-col items-center text-center"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="rounded-3xl bg-white p-4 shadow-2xl shadow-primary/20 md:p-5">
            <QRCode value={joinLink} size={200} level="M" />
          </div>
          <p className="mt-5 text-sm font-bold uppercase tracking-[0.2em] text-white/70">Scan to join & spray</p>
          <p className="mt-4 font-mono text-3xl font-black tracking-[0.35em] text-primary md:text-4xl">
            {event.eventCode}
          </p>
        </motion.div>
      </div>
    </div>
  );
}

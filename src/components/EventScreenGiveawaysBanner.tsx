import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Gift } from "lucide-react";
import QRCode from "react-qr-code";
import { buildGiveawayRedeemLink } from "@/lib/shareLinks";
import type { ProjectorGiveawayDisplay } from "@/hooks/useEventScreenGiveaways";

export interface EventScreenGiveaway {
  id: string;
  title: string;
  code: string;
  perPersonAmount: number;
  remainingAmount: number;
}

interface EventScreenGiveawaysBannerProps {
  giveaways: ProjectorGiveawayDisplay[];
  compact?: boolean;
  /** Rotate through drops one at a time (use when sprays are live). */
  carousel?: boolean;
  rotateIntervalMs?: number;
}

function EventScreenGiveawayCard({
  giveaway,
  compact,
}: {
  giveaway: ProjectorGiveawayDisplay;
  compact: boolean;
}) {
  const redeemLink = buildGiveawayRedeemLink(giveaway.code);
  const qrSize = compact ? 80 : 112;
  const { spotsLeft, exhausted } = giveaway;

  return (
    <div
      className={`rounded-2xl border backdrop-blur-md ${
        exhausted
          ? "border-white/20 bg-black/45 opacity-90"
          : "border-primary/30 bg-black/55"
      }`}
    >
      <div className={`flex items-center gap-3 ${compact ? "px-3 py-2.5" : "px-4 py-4 md:gap-4"}`}>
        <div className={`shrink-0 rounded-xl bg-white ${compact ? "p-1.5" : "p-2"} ${exhausted ? "opacity-60" : ""}`}>
          <QRCode value={redeemLink} size={qrSize} level="M" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <Gift className={`shrink-0 text-primary ${compact ? "h-4 w-4" : "h-5 w-5"}`} />
            <p className={`truncate font-bold text-white ${compact ? "text-sm" : "text-base md:text-lg"}`}>
              {giveaway.title}
            </p>
          </div>

          <p
            className={`font-semibold ${exhausted ? "text-white/60" : "text-primary"} ${compact ? "text-xs" : "text-sm md:text-base"}`}
          >
            {exhausted ? "All claimed!" : `Scan to redeem · ₦${giveaway.perPersonAmount.toLocaleString()}`}
          </p>

          <p
            className={`mt-1 font-mono font-black tracking-[0.2em] text-white ${
              compact ? "text-base" : "text-xl md:text-2xl"
            } ${exhausted ? "opacity-70" : ""}`}
          >
            {giveaway.code}
          </p>

          <p
            className={`mt-0.5 ${compact ? "text-[10px]" : "text-xs md:text-sm"} ${exhausted ? "text-white/50" : "text-white/55"}`}
          >
            {spotsLeft} {spotsLeft === 1 ? "spot" : "spots"} left
          </p>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_ROTATE_MS = 8_000;

export function EventScreenGiveawaysBanner({
  giveaways,
  compact = false,
  carousel = false,
  rotateIntervalMs = DEFAULT_ROTATE_MS,
}: EventScreenGiveawaysBannerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const useCarousel = carousel && giveaways.length > 1;
  const giveawayIds = giveaways.map((g) => g.id).join("|");

  useEffect(() => {
    setActiveIndex(0);
  }, [giveawayIds]);

  useEffect(() => {
    if (activeIndex >= giveaways.length) {
      setActiveIndex(Math.max(0, giveaways.length - 1));
    }
  }, [activeIndex, giveaways.length]);

  useEffect(() => {
    if (!useCarousel) return;

    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % giveaways.length);
    }, rotateIntervalMs);

    return () => window.clearInterval(timer);
  }, [useCarousel, giveaways.length, rotateIntervalMs]);

  if (giveaways.length === 0) return null;

  const activeGiveaway = giveaways[activeIndex] ?? giveaways[0];
  const moreCount = giveaways.length - 1;

  return (
    <div
      className={
        compact
          ? "pointer-events-none absolute left-4 top-4 z-30 w-[min(100%,20rem)] md:left-6 md:top-6 md:w-80"
          : "relative z-20 shrink-0 px-5 pb-3 md:px-8"
      }
    >
      {useCarousel ? (
        <div className="space-y-2">
          <div className="relative overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeGiveaway.id}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              >
                <EventScreenGiveawayCard giveaway={activeGiveaway} compact={compact} />
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex items-center justify-between gap-2 px-1">
            <span className="rounded-full border border-primary/30 bg-primary/15 px-2.5 py-0.5 text-[10px] font-semibold text-primary md:text-xs">
              +{moreCount} more {moreCount === 1 ? "drop" : "drops"}
            </span>
            <span className="text-[10px] font-medium text-white/45 md:text-xs">
              {activeIndex + 1} / {giveaways.length}
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-2 md:space-y-3">
          {giveaways.map((giveaway) => (
            <motion.div
              key={giveaway.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3 }}
            >
              <EventScreenGiveawayCard giveaway={giveaway} compact={compact} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

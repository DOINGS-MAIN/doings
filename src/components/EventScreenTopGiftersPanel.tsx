import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import type { EventTopGifter } from "@/hooks/useEventSprayFeed";
import { SprayAvatarCharacter } from "@/components/SprayAvatarCharacter";
import { cn } from "@/lib/utils";

const RANK_STYLES: Record<number, string> = {
  1: "border-primary/40 bg-primary/15",
  2: "border-white/20 bg-white/10",
  3: "border-white/10 bg-white/5",
};

interface EventScreenTopGiftersPanelProps {
  topGifters: EventTopGifter[];
  compact?: boolean;
  className?: string;
}

export function EventScreenTopGiftersPanel({
  topGifters,
  compact = false,
  className,
}: EventScreenTopGiftersPanelProps) {
  if (topGifters.length === 0) return null;

  return (
    <motion.aside
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "pointer-events-none rounded-2xl border border-white/15 bg-black/60 backdrop-blur-md shadow-xl",
        compact ? "p-2.5 w-[min(42vw,11rem)]" : "p-3 md:p-4 w-[min(88vw,15rem)] md:w-56",
        className,
      )}
      aria-label="Top sprayers at this event"
    >
      <div className={cn("flex items-center gap-2", compact ? "mb-2" : "mb-3")}>
        <Trophy className={cn("text-primary shrink-0", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
        <p
          className={cn(
            "font-bold uppercase tracking-wide text-white",
            compact ? "text-[10px]" : "text-xs md:text-sm",
          )}
        >
          Top sprayers
        </p>
      </div>

      <ul className={cn("space-y-2", compact && "space-y-1.5")}>
        {topGifters.map((gifter, index) => {
          const rank = index + 1;
          return (
            <li
              key={gifter.sprayerId}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-2 py-2",
                RANK_STYLES[rank] ?? "border-white/10 bg-white/5",
                compact && "px-1.5 py-1.5",
              )}
            >
              <span
                className={cn(
                  "shrink-0 font-black text-primary tabular-nums",
                  compact ? "text-[10px] w-4" : "text-xs w-5",
                )}
              >
                #{rank}
              </span>
              <div className="shrink-0 scale-[0.55] origin-left -mr-3">
                <SprayAvatarCharacter
                  avatar={gifter.avatarData}
                  name={gifter.name}
                  size="xs"
                  showGlow={rank === 1}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate font-semibold text-white",
                    compact ? "text-[10px]" : "text-xs md:text-sm",
                  )}
                >
                  {gifter.name}
                </p>
                <p
                  className={cn(
                    "font-bold text-primary tabular-nums",
                    compact ? "text-[10px]" : "text-xs md:text-sm",
                  )}
                >
                  ₦{gifter.amount.toLocaleString()}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </motion.aside>
  );
}

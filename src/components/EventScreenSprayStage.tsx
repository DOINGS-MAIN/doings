import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import gsap from "gsap";
import { SprayAvatarCharacter } from "@/components/SprayAvatarCharacter";
import { createSprayBillElement, formatSprayDenomination } from "@/lib/sprayNotes";
import type { SprayStageEntry } from "@/hooks/useSprayStage";
import type { EventSprayActivity } from "@/hooks/useEventSprayFeed";

interface SprayStageSlotProps {
  spray: EventSprayActivity | null;
  slotIndex: number;
}

function SprayStageSlot({ spray, slotIndex }: SprayStageSlotProps) {
  const rainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!spray || !rainRef.current) return;

    const container = rainRef.current;
    const notes: HTMLDivElement[] = [];
    let cancelled = false;

    const spawnBill = () => {
      if (cancelled || !container) return;
      const el = createSprayBillElement(spray.denomination, "md");
      el.style.left = `${8 + Math.random() * 84}%`;
      el.style.top = "0";
      container.appendChild(el);
      notes.push(el);

      gsap.to(el, {
        y: container.clientHeight + 80,
        x: `+=${(Math.random() - 0.5) * 60}`,
        rotation: Math.random() * 540 - 270,
        duration: 1.2 + Math.random() * 0.8,
        ease: "power1.in",
        onComplete: () => {
          el.remove();
          const idx = notes.indexOf(el);
          if (idx >= 0) notes.splice(idx, 1);
        },
      });
    };

    spawnBill();
    const interval = window.setInterval(spawnBill, 160);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      notes.forEach((note) => note.remove());
    };
  }, [spray?.id, spray?.denomination]);

  return (
    <motion.div
      layout
      className="relative flex min-h-[220px] flex-col overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/15 via-black/40 to-background/80 shadow-lg shadow-primary/10 md:min-h-[280px]"
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 bg-black/35 px-3 py-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-white/70 md:text-xs">
        <span>Stage {slotIndex + 1}</span>
        {spray?.isLive && (
          <span className="rounded-full bg-green-500/90 px-2 py-0.5 text-[9px] font-bold text-white md:text-[10px]">
            Spraying now
          </span>
        )}
      </div>

      {spray ? (
        <>
          <div ref={rainRef} className="absolute inset-0 overflow-hidden" />
          <div className="relative z-10 flex flex-1 flex-col items-center justify-end px-3 pb-4 pt-10">
            <SprayAvatarCharacter
              avatar={spray.avatarData}
              name={spray.name}
              size="lg"
              dancing
              danceStyle="spray"
              showGlow
            />
            <p className="mt-3 max-w-full truncate text-lg font-black text-white drop-shadow md:text-xl">
              {spray.name}
            </p>
            <p className="text-2xl font-black text-primary md:text-3xl">₦{spray.amount.toLocaleString()}</p>
            <p className="text-xs font-semibold text-white/75 md:text-sm">
              {formatSprayDenomination(spray.denomination)} notes
            </p>
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
          <motion.div
            animate={{ opacity: [0.35, 0.7, 0.35] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="text-4xl"
          >
            💸
          </motion.div>
          <p className="mt-3 text-sm font-medium text-muted-foreground">Waiting for next sprayer…</p>
        </div>
      )}
    </motion.div>
  );
}

interface QueuedSprayerChipProps {
  spray: EventSprayActivity;
  position: number;
}

function QueuedSprayerChip({ spray, position }: QueuedSprayerChipProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2 backdrop-blur"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/30 text-xs font-bold text-primary">
        {position}
      </span>
      <SprayAvatarCharacter avatar={spray.avatarData} name={spray.name} size="xs" dancing danceStyle="bounce" />
      <div className="min-w-0">
        <p className="max-w-[7rem] truncate text-sm font-bold text-white">
          {spray.name}
          {spray.isLive && <span className="ml-1 text-[10px] text-green-400">LIVE</span>}
        </p>
        <p className="text-xs text-white/70">
          ₦{spray.amount.toLocaleString()} · {formatSprayDenomination(spray.denomination)}
        </p>
      </div>
    </motion.div>
  );
}

interface EventScreenSprayStageProps {
  slots: (SprayStageEntry | null)[];
  queuedSprays: SprayStageEntry[];
  waitingCount: number;
}

export function EventScreenSprayStage({ slots, queuedSprays, waitingCount }: EventScreenSprayStageProps) {
  return (
    <section className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          <h3 className="text-sm font-bold uppercase tracking-wide text-foreground md:text-base">
            Live Sprayer Stage
          </h3>
          <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
            Up to 3 at once
          </span>
        </div>
        {waitingCount > 0 && (
          <p className="text-xs font-medium text-muted-foreground md:text-sm">
            {waitingCount} in line — everyone gets a turn
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {slots.map((slot, index) => (
          <SprayStageSlot key={`slot-${index}-${slot?.id ?? "empty"}`} spray={slot?.spray ?? null} slotIndex={index} />
        ))}
      </div>

      <div className="glass rounded-2xl p-3 md:p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground md:text-sm">
            Up next ({queuedSprays.length})
          </p>
          {queuedSprays.length === 0 && (
            <p className="text-xs text-muted-foreground">Queue empty — next sprayer appears here instantly</p>
          )}
        </div>

        {queuedSprays.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
            {queuedSprays.map((entry, index) => (
              <QueuedSprayerChip key={entry.id} spray={entry.spray} position={index + 1} />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <SprayAvatarCharacter size="xs" dancing danceStyle="idle" />
            <span>No one waiting — all sprayers are on stage or in the feed below</span>
          </div>
        )}
      </div>
    </section>
  );
}

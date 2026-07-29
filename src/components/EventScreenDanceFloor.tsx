import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import gsap from "gsap";
import { SprayAvatarCharacter } from "@/components/SprayAvatarCharacter";
import { createSprayBillElement, formatSprayDenomination } from "@/lib/sprayNotes";
import type { EventSprayActivity } from "@/hooks/useEventSprayFeed";
import type { SprayAvatarSize } from "@/components/SprayAvatarCharacter";

/** Horizontal stage slots — up to 3 sprayers side by side on the dance floor. */
const STAGE_LAYOUTS: Record<number, Array<{ x: number; y: number; scale: number }>> = {
  1: [{ x: 50, y: 50, scale: 1.08 }],
  2: [
    { x: 30, y: 50, scale: 0.98 },
    { x: 70, y: 50, scale: 0.98 },
  ],
  3: [
    { x: 20, y: 52, scale: 0.92 },
    { x: 50, y: 48, scale: 1 },
    { x: 80, y: 52, scale: 0.92 },
  ],
};

function stageSlotStyle(index: number, total: number) {
  const layout = STAGE_LAYOUTS[Math.min(Math.max(total, 1), 3)] ?? STAGE_LAYOUTS[3];
  const slot = layout[index] ?? layout[layout.length - 1];
  return {
    left: `${slot.x}%`,
    top: `${slot.y}%`,
    scale: slot.scale,
    zIndex: 20 + (layout.length - index),
  };
}

function avatarSizeForCount(total: number): SprayAvatarSize {
  if (total <= 1) return "hero";
  if (total === 2) return "lg";
  return "md";
}

interface DanceFloorSprayerProps {
  spray: EventSprayActivity;
  index: number;
  total: number;
}

function DanceFloorSprayer({ spray, index, total }: DanceFloorSprayerProps) {
  const rainRef = useRef<HTMLDivElement>(null);
  const slot = stageSlotStyle(index, total);
  const avatarSize = avatarSizeForCount(total);

  useEffect(() => {
    if (!rainRef.current) return;

    const container = rainRef.current;
    const notes: HTMLDivElement[] = [];
    let cancelled = false;

    const spawnBill = () => {
      if (cancelled || !container) return;
      const el = createSprayBillElement(spray.denomination, "md");
      el.style.left = `${10 + Math.random() * 80}%`;
      el.style.top = "0";
      container.appendChild(el);
      notes.push(el);

      gsap.to(el, {
        y: container.clientHeight + 60,
        x: `+=${(Math.random() - 0.5) * 40}`,
        rotation: Math.random() * 480 - 240,
        duration: 1 + Math.random() * 0.7,
        ease: "power1.in",
        onComplete: () => {
          el.remove();
          const idx = notes.indexOf(el);
          if (idx >= 0) notes.splice(idx, 1);
        },
      });
    };

    spawnBill();
    const interval = window.setInterval(spawnBill, 180);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      notes.forEach((note) => note.remove());
    };
  }, [spray.id, spray.denomination]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: slot.scale * 0.5, x: "-50%", y: "-50%" }}
      animate={{ opacity: 1, scale: slot.scale, x: "-50%", y: "-50%" }}
      exit={{ opacity: 0, scale: slot.scale * 0.6, x: "-50%", y: "-50%" }}
      transition={{ type: "spring", stiffness: 280, damping: 22 }}
      className="absolute w-[min(30vw,200px)]"
      style={{ left: slot.left, top: slot.top, zIndex: slot.zIndex }}
    >
      <div className="relative flex flex-col items-center">
        <div
          ref={rainRef}
          className="pointer-events-none absolute -inset-x-8 -top-16 bottom-0 overflow-hidden"
          aria-hidden
        />
        <SprayAvatarCharacter
          avatar={spray.avatarData}
          name={spray.name}
          size={avatarSize}
          dancing
          danceStyle="spray"
          showGlow
        />
        <p className="mt-3 max-w-full truncate text-center text-base font-black text-white drop-shadow-lg md:text-lg">
          {spray.name}
        </p>
        <p className="text-xl font-black text-primary drop-shadow md:text-2xl">
          ₦{spray.amount.toLocaleString()}
        </p>
        <p className="text-xs font-semibold text-white/80 md:text-sm">
          {formatSprayDenomination(spray.denomination)} notes
          {spray.isLive && (
            <span className="ml-2 rounded-full bg-green-500/90 px-2 py-0.5 text-[10px] font-bold text-white">
              LIVE
            </span>
          )}
        </p>
      </div>
    </motion.div>
  );
}

interface EventScreenDanceFloorProps {
  sprayers: EventSprayActivity[];
}

export function EventScreenDanceFloor({ sprayers }: EventScreenDanceFloorProps) {
  return (
    <section className="relative flex h-full min-h-[50vh] items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_55%,hsl(43_96%_56%/0.12),transparent_60%)]" />

      {sprayers.map((spray, index) => (
        <DanceFloorSprayer
          key={spray.id}
          spray={spray}
          index={index}
          total={sprayers.length}
        />
      ))}
    </section>
  );
}

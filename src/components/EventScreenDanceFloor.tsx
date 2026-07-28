import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import gsap from "gsap";
import { SprayAvatarCharacter } from "@/components/SprayAvatarCharacter";
import { createSprayBillElement, formatSprayDenomination } from "@/lib/sprayNotes";
import type { EventSprayActivity } from "@/hooks/useEventSprayFeed";

/** Stacked offsets — sprayers cluster in the center like a dance floor. */
const STACK_OFFSETS = [
  { x: 0, y: 0, scale: 1.08, z: 50 },
  { x: -11, y: 9, scale: 0.94, z: 40 },
  { x: 12, y: 7, scale: 0.96, z: 42 },
  { x: -7, y: -11, scale: 0.9, z: 35 },
  { x: 9, y: -9, scale: 0.92, z: 38 },
  { x: -14, y: -3, scale: 0.88, z: 32 },
  { x: 15, y: -2, scale: 0.89, z: 33 },
  { x: 0, y: 12, scale: 0.86, z: 30 },
];

function stackStyle(index: number, total: number) {
  const preset = STACK_OFFSETS[index % STACK_OFFSETS.length];
  const spread = total > 4 ? 1.15 : 1;
  return {
    x: preset.x * spread,
    y: preset.y * spread,
    scale: Math.max(0.75, preset.scale - Math.floor(index / STACK_OFFSETS.length) * 0.04),
    zIndex: preset.z - index,
  };
}

interface DanceFloorSprayerProps {
  spray: EventSprayActivity;
  index: number;
  total: number;
}

function DanceFloorSprayer({ spray, index, total }: DanceFloorSprayerProps) {
  const rainRef = useRef<HTMLDivElement>(null);
  const { x, y, scale, zIndex } = stackStyle(index, total);

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
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ type: "spring", stiffness: 280, damping: 22 }}
      className="absolute left-1/2 top-1/2"
      style={{ zIndex }}
    >
      <div
        className="relative flex w-[min(42vw,220px)] flex-col items-center"
        style={{
          transform: `translate(calc(-50% + ${x * 0.35}rem), calc(-50% + ${y * 0.35}rem)) scale(${scale})`,
        }}
      >
        <div
          ref={rainRef}
          className="pointer-events-none absolute -inset-x-8 -top-16 bottom-0 overflow-hidden"
          aria-hidden
        />
        <SprayAvatarCharacter
          avatar={spray.avatarData}
          name={spray.name}
          size={total <= 2 ? "hero" : "lg"}
          dancing
          danceStyle="spray"
          showGlow
        />
        <p className="mt-3 max-w-full truncate text-center text-lg font-black text-white drop-shadow-lg md:text-xl">
          {spray.name}
        </p>
        <p className="text-2xl font-black text-primary drop-shadow md:text-3xl">
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

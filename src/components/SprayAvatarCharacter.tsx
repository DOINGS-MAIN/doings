import { motion } from "framer-motion";
import type { AvatarData } from "@/types/avatar";
import { avatarDataFromProfile } from "@/types/avatar";
import { getAccessory, getBackground, getOutfit } from "@/lib/avatarConfig";

export type SprayAvatarSize = "xs" | "sm" | "md" | "lg" | "hero";
export type SprayDanceStyle = "idle" | "bounce" | "sway" | "celebrate" | "spray";

const SIZE_MAP: Record<
  SprayAvatarSize,
  { head: number; bodyW: number; bodyH: number; arm: number; emoji: string; ring: number }
> = {
  xs: { head: 28, bodyW: 22, bodyH: 18, arm: 10, emoji: "text-sm", ring: 2 },
  sm: { head: 40, bodyW: 32, bodyH: 26, arm: 14, emoji: "text-lg", ring: 2 },
  md: { head: 56, bodyW: 44, bodyH: 36, arm: 18, emoji: "text-2xl", ring: 3 },
  lg: { head: 80, bodyW: 64, bodyH: 52, arm: 26, emoji: "text-4xl", ring: 4 },
  hero: { head: 112, bodyW: 88, bodyH: 72, arm: 36, emoji: "text-5xl", ring: 5 },
};

const DANCE_VARIANTS = {
  idle: {
    body: { y: [0, -2, 0], transition: { duration: 2, repeat: Infinity, ease: "easeInOut" } },
    leftArm: { rotate: [18, 22, 18] },
    rightArm: { rotate: [-18, -22, -18] },
  },
  bounce: {
    body: { y: [0, -14, 0, -8, 0], rotate: [0, -3, 0, 3, 0] },
    leftArm: { rotate: [30, -20, 40, -10, 30] },
    rightArm: { rotate: [-30, 20, -40, 10, -30] },
  },
  sway: {
    body: { x: [-8, 8, -8], rotate: [-6, 6, -6] },
    leftArm: { rotate: [10, 45, 10] },
    rightArm: { rotate: [-10, -45, -10] },
  },
  celebrate: {
    body: { y: [0, -24, 0], scale: [1, 1.08, 1], rotate: [0, 8, -8, 0] },
    leftArm: { rotate: [20, 160, 20] },
    rightArm: { rotate: [-20, -160, -20] },
  },
  spray: {
    body: { y: [0, -6, 0], rotate: [-4, 4, -4] },
    leftArm: { rotate: [40, 80, 40] },
    rightArm: { rotate: [-20, 60, -20] },
  },
};

export interface SprayAvatarCharacterProps {
  avatar?: AvatarData | null;
  avatarUrl?: string | null;
  avatarDataRaw?: unknown;
  name?: string;
  size?: SprayAvatarSize;
  dancing?: boolean;
  danceStyle?: SprayDanceStyle;
  className?: string;
  showGlow?: boolean;
}

export function SprayAvatarCharacter({
  avatar,
  avatarUrl,
  avatarDataRaw,
  name,
  size = "md",
  dancing = false,
  danceStyle = "bounce",
  className = "",
  showGlow = false,
}: SprayAvatarCharacterProps) {
  const data = avatar ?? avatarDataFromProfile(avatarDataRaw, avatarUrl);
  const outfit = getOutfit(data.outfit);
  const accessory = getAccessory(data.accessory);
  const background = getBackground(data.background);
  const dims = SIZE_MAP[size];
  const dance = DANCE_VARIANTS[dancing ? danceStyle : "idle"];
  const loopTransition = { duration: dancing && danceStyle === "celebrate" ? 0.7 : 0.9, repeat: Infinity, ease: "easeInOut" as const };

  const headContent = data.photoUrl ? (
    <img src={data.photoUrl} alt={name ?? "Sprayer"} className="h-full w-full object-cover" />
  ) : (
    <span className={dims.emoji}>{outfit.emoji}</span>
  );

  return (
    <div className={`relative inline-flex flex-col items-center ${className}`}>
      {showGlow && (
        <motion.div
          className={`absolute inset-0 rounded-full bg-gradient-to-br ${background.colors} blur-2xl opacity-40`}
          animate={dancing ? { scale: [1, 1.2, 1], opacity: [0.3, 0.55, 0.3] } : {}}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
      )}

      {data.accessory !== "none" && (
        <motion.span
          className={`absolute z-20 ${dims.emoji}`}
          style={{ top: -dims.head * 0.22, right: -dims.head * 0.08 }}
          animate={dancing ? { y: [0, -4, 0], rotate: [0, 12, -12, 0] } : {}}
          transition={loopTransition}
        >
          {accessory.emoji}
        </motion.span>
      )}

      <motion.div
        className="relative z-10 flex flex-col items-center"
        animate={dance.body}
        transition={loopTransition}
      >
        <div
          className={`rounded-full bg-gradient-to-br ${background.colors} p-[2px] shadow-lg`}
          style={{ padding: dims.ring }}
        >
          <div
            className="overflow-hidden rounded-full bg-card flex items-center justify-center"
            style={{ width: dims.head, height: dims.head }}
          >
            {headContent}
          </div>
        </div>

        <div className="relative flex items-start justify-center" style={{ marginTop: -dims.head * 0.12 }}>
          <motion.div
            className={`absolute origin-top-right rounded-full bg-gradient-to-br ${outfit.color} opacity-90`}
            style={{ width: dims.arm, height: dims.bodyH * 0.85, top: dims.bodyH * 0.08, left: -dims.bodyW * 0.55 }}
            animate={dance.leftArm}
            transition={loopTransition}
          />
          <motion.div
            className={`absolute origin-top-left rounded-full bg-gradient-to-br ${outfit.color} opacity-90`}
            style={{ width: dims.arm, height: dims.bodyH * 0.85, top: dims.bodyH * 0.08, right: -dims.bodyW * 0.55 }}
            animate={dance.rightArm}
            transition={loopTransition}
          />

          <div
            className={`relative rounded-[40%] bg-gradient-to-b ${outfit.color} shadow-md`}
            style={{ width: dims.bodyW, height: dims.bodyH }}
          >
            <div className="absolute inset-x-2 top-2 h-1/3 rounded-full bg-white/15" />
            <span
              className="absolute bottom-1 left-1/2 -translate-x-1/2 opacity-80"
              style={{ fontSize: Math.max(10, dims.bodyW * 0.28) }}
            >
              {outfit.emoji}
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export const AVATAR_OUTFITS = [
  { id: "agbada", name: "Agbada", emoji: "👘", color: "from-amber-500 to-yellow-600" },
  { id: "suit", name: "Classic Suit", emoji: "🤵", color: "from-slate-600 to-slate-800" },
  { id: "dashiki", name: "Dashiki", emoji: "👕", color: "from-green-500 to-emerald-600" },
  { id: "kaftan", name: "Kaftan", emoji: "🧥", color: "from-purple-500 to-violet-600" },
  { id: "casual", name: "Casual", emoji: "👔", color: "from-blue-500 to-cyan-600" },
  { id: "aso-oke", name: "Aso Oke", emoji: "🎭", color: "from-orange-500 to-red-600" },
] as const;

export const AVATAR_ACCESSORIES = [
  { id: "none", name: "None", emoji: "✨" },
  { id: "cap", name: "Fila Cap", emoji: "🧢" },
  { id: "crown", name: "Crown", emoji: "👑" },
  { id: "glasses", name: "Shades", emoji: "🕶️" },
  { id: "chain", name: "Gold Chain", emoji: "⛓️" },
  { id: "watch", name: "Luxury Watch", emoji: "⌚" },
] as const;

export const AVATAR_BACKGROUNDS = [
  { id: "gold-gradient", name: "Gold", colors: "from-amber-500 via-yellow-400 to-amber-600" },
  { id: "purple-gradient", name: "Royal", colors: "from-purple-600 via-violet-500 to-purple-700" },
  { id: "green-gradient", name: "Naija", colors: "from-green-600 via-emerald-500 to-green-700" },
  { id: "cyan-gradient", name: "Ocean", colors: "from-cyan-500 via-blue-400 to-cyan-600" },
  { id: "red-gradient", name: "Fire", colors: "from-red-500 via-orange-400 to-red-600" },
  { id: "dark-gradient", name: "Elite", colors: "from-slate-800 via-slate-700 to-slate-900" },
] as const;

export type AvatarOutfitId = (typeof AVATAR_OUTFITS)[number]["id"];
export type AvatarAccessoryId = (typeof AVATAR_ACCESSORIES)[number]["id"];
export type AvatarBackgroundId = (typeof AVATAR_BACKGROUNDS)[number]["id"];

export function getOutfit(id: string) {
  return AVATAR_OUTFITS.find((o) => o.id === id) ?? AVATAR_OUTFITS[0];
}

export function getAccessory(id: string) {
  return AVATAR_ACCESSORIES.find((a) => a.id === id) ?? AVATAR_ACCESSORIES[0];
}

export function getBackground(id: string) {
  return AVATAR_BACKGROUNDS.find((b) => b.id === id) ?? AVATAR_BACKGROUNDS[0];
}

/** ProfileScreen legacy map */
export const backgrounds = Object.fromEntries(
  AVATAR_BACKGROUNDS.map((b) => [b.id, b.colors]),
) as Record<string, string>;

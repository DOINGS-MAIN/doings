import { KOBO_PER_BUNDLE } from "./money.ts";

// create_giveaway_funded (113) refuses with "GIVEAWAY_DAILY_LIMIT <kobo left today>".
// The app speaks in bundles, so what is left is given in whole bundles.
// Same minimum as create_giveaway_funded ("Minimum total is ₦100").
const MIN_GIVEAWAY_TOTAL_KOBO = 10_000;
const REACHED = "You've reached today's giveaway limit. Try again tomorrow.";

export function giveawayLimitMessage(dbMessage: string): string | null {
  const m = /GIVEAWAY_DAILY_LIMIT(?:\s+(\d+))?/.exec(dbMessage);
  if (!m) return null;
  const leftKobo = Number(m[1] ?? 0);
  // Less than the smallest giveaway left is nothing left: a lower amount would be refused too.
  if (leftKobo < MIN_GIVEAWAY_TOTAL_KOBO) return REACHED;
  const left = Math.floor(leftKobo / KOBO_PER_BUNDLE);
  return `You can give away up to ${left.toLocaleString("en-US")} more ${left === 1 ? "bundle" : "bundles"} today. Lower the amount or try again tomorrow.`;
}

// spray_daily_check (115) refuses with "SPRAY_DAILY_LIMIT <kobo left today>". The smallest spray is
// one 200-bundle note, so less than that left is nothing left.
const MIN_SPRAY_KOBO = 20_000;
const SPRAY_REACHED = "You've reached today's spray limit. Try again tomorrow.";

export function sprayLimitMessage(dbMessage: string): string | null {
  const m = /SPRAY_DAILY_LIMIT(?:\s+(\d+))?/.exec(dbMessage);
  if (!m) return null;
  const leftKobo = Number(m[1] ?? 0);
  if (leftKobo < MIN_SPRAY_KOBO) return SPRAY_REACHED;
  const left = Math.floor(leftKobo / KOBO_PER_BUNDLE);
  return `You can spray up to ${left.toLocaleString("en-US")} more bundles today. Lower the amount or try again tomorrow.`;
}

/**
 * Dance floor settings (new app's floor queue): amount bands → floor time, the busy-floor rule and
 * the max wait. The database (set_spray_floor_settings) is the authority; these checks mirror it so
 * the admin page can explain a problem before saving.
 */
export type FloorBand = { from_ngn: number; seconds: number };

export type FloorSettings = {
  bands: FloorBand[];
  busy_threshold: number;
  busy_shrink_pct: number;
  min_seconds: number;
  max_wait_seconds: number;
};

export const DEFAULT_FLOOR_SETTINGS: FloorSettings = {
  bands: [
    { from_ngn: 0, seconds: 60 },
    { from_ngn: 5000, seconds: 120 },
    { from_ngn: 50000, seconds: 240 },
    { from_ngn: 200000, seconds: 360 },
  ],
  busy_threshold: 10,
  busy_shrink_pct: 30,
  min_seconds: 45,
  max_wait_seconds: 1800,
};

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function parseFloorSettings(raw: unknown): FloorSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_FLOOR_SETTINGS;
  const r = raw as Record<string, unknown>;
  const bands = Array.isArray(r.bands)
    ? r.bands
        .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
        .map((b) => ({ from_ngn: num(b.from_ngn, 0), seconds: num(b.seconds, 60) }))
    : DEFAULT_FLOOR_SETTINGS.bands;
  return {
    bands: bands.length ? bands : DEFAULT_FLOOR_SETTINGS.bands,
    busy_threshold: num(r.busy_threshold, DEFAULT_FLOOR_SETTINGS.busy_threshold),
    busy_shrink_pct: num(r.busy_shrink_pct, DEFAULT_FLOOR_SETTINGS.busy_shrink_pct),
    min_seconds: num(r.min_seconds, DEFAULT_FLOOR_SETTINGS.min_seconds),
    max_wait_seconds: num(r.max_wait_seconds, DEFAULT_FLOOR_SETTINGS.max_wait_seconds),
  };
}

const whole = (n: number) => Number.isInteger(n);

/** Same rules and wording as public.floor_settings_errors (migration 088); null when valid. */
export function floorSettingsError(s: FloorSettings): string | null {
  if (s.bands.length < 1 || s.bands.length > 6) return "Use 1 to 6 bands";
  let prev = -1;
  let shortest = Infinity;
  for (const [i, b] of s.bands.entries()) {
    if (i === 0 && b.from_ngn !== 0) return "The first band must start at ₦0";
    if (b.from_ngn <= prev || !whole(b.from_ngn)) return "Band amounts must be whole naira and go up";
    if (b.seconds < 15 || b.seconds > 900 || !whole(b.seconds)) return "Band times must be whole seconds from 15 to 900";
    prev = b.from_ngn;
    shortest = Math.min(shortest, b.seconds);
  }
  if (s.busy_threshold < 1) return "busy_threshold must be at least 1";
  if (s.busy_shrink_pct < 0 || s.busy_shrink_pct > 70) return "busy_shrink_pct must be 0 to 70";
  if (s.min_seconds < 15 || s.min_seconds > shortest) return "min_seconds must be from 15 to the shortest band";
  if (s.max_wait_seconds < 300 || s.max_wait_seconds > 7200) return "max_wait_seconds must be 300 to 7200";
  return null;
}

/** Floor seconds an amount buys (the last band starting at or below it). */
export function floorTimeFor(s: FloorSettings, amountNgn: number): number {
  const band = [...s.bands].reverse().find((b) => b.from_ngn <= amountNgn) ?? s.bands[0];
  return band?.seconds ?? 0;
}

/** Helpers for the Ads admin page (migration 092; rules mirror the database CHECKs). */
export type AdminAd = {
  id: string; title: string; image_mobile_path: string; image_desktop_path: string | null; link_url: string | null;
  priority: number; starts_at: string; ends_at: string | null; is_active: boolean; views: number; taps: number; created_at: string;
};
export type AdStatus = "Live" | "Scheduled" | "Ended" | "Paused";

const LINK = /^(https:\/\/\S+|\/([^/\\\s]\S*)?)$/;
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 1_048_576;
const TARGET = { mobile: 960 / 319, desktop: 1083 / 131 };

export const AD_IMAGE_BASE = `${import.meta.env.VITE_SUPABASE_URL ?? ""}/storage/v1/object/public/ads/`;

export function adStatus(ad: Pick<AdminAd, "is_active" | "starts_at" | "ends_at">, now = Date.now()): AdStatus {
  if (!ad.is_active) return "Paused";
  if (Date.parse(ad.starts_at) > now) return "Scheduled";
  if (ad.ends_at && Date.parse(ad.ends_at) <= now) return "Ended";
  return "Live";
}

export function adLinkError(link: string): string | null {
  if (!link) return null;
  return LINK.test(link) ? null : "Use https://… or an app path starting with / (e.g. /event/ABC123)";
}

export function adImageError(file: { type: string; size: number }): string | null {
  if (!TYPES.includes(file.type)) return "Use a JPEG, PNG or WebP image";
  if (file.size > MAX_BYTES) return "Image must be 1 MB or smaller";
  return null;
}

export function adAspectWarning(w: number, h: number, kind: "mobile" | "desktop"): string | null {
  if (!w || !h) return null;
  const off = Math.abs(w / h - TARGET[kind]) / TARGET[kind];
  return off > 0.15
    ? `This image is ${w}×${h}; the ${kind} banner is about ${kind === "mobile" ? "960×319" : "1083×131"}, so it will be cropped`
    : null;
}

export function tapRate(views: number, taps: number): string {
  return views > 0 ? `${Math.round((taps / views) * 1000) / 10}%` : "—";
}

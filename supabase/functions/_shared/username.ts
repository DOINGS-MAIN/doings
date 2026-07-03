export const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

export function normalizeUsername(raw: string): string {
  let s = raw.trim().toLowerCase();
  if (s.startsWith("@")) s = s.slice(1);
  return s.replace(/[^a-z0-9_]/g, "").slice(0, 30);
}

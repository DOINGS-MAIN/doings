/** Stored without @; lowercase letters, digits, underscore; 3–30 chars */
export const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

export function normalizeUsernameInput(raw: string): string {
  let s = raw.trim().toLowerCase();
  if (s.startsWith("@")) s = s.slice(1);
  return s.replace(/[^a-z0-9_]/g, "").slice(0, 30);
}

export function formatUsername(username: string): string {
  const normalized = normalizeUsernameInput(username);
  return normalized ? `@${normalized}` : "";
}

export function usernameRpcError(err: unknown, fallback = "Could not save username"): string {
  if (err && typeof err === "object" && "message" in err) {
    const msg = String((err as { message: unknown }).message).trim();
    if (/username.*taken|USERNAME_TAKEN|duplicate key.*username/i.test(msg)) {
      return "This username is already taken";
    }
    if (/INVALID_USERNAME|valid username/i.test(msg)) {
      return "Username must be 3–30 characters: letters, numbers, underscore only";
    }
    if (msg) return msg;
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

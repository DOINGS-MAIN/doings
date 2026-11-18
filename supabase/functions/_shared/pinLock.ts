/**
 * The message for a locked PIN. Locks grow (15 minutes, 1 hour, 6 hours, 24 hours: migration 108), so
 * the wait is read from the lock itself instead of being written into the text.
 */
export function pinLockedMessage(lockedUntil: string | null | undefined, now: Date = new Date()): string {
  const lead = "Too many incorrect PIN attempts. ";
  const ms = lockedUntil ? new Date(lockedUntil).getTime() - now.getTime() : NaN;
  if (!Number.isFinite(ms) || ms <= 0) return lead + "Try again later.";
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return lead + `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  const hours = Math.ceil(minutes / 60);
  return lead + `Try again in ${hours} hour${hours === 1 ? "" : "s"}.`;
}

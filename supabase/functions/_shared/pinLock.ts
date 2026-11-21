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

/** Wrong guesses allowed before the PIN locks (check_transaction_pin, migration 108). */
export const PIN_MAX_ATTEMPTS = 5;

/** The message for a wrong PIN, with the tries left before the lock when the count is known. */
export function pinWrongMessage(failedAttempts: number | null | undefined): string {
  const base = "Incorrect transaction PIN";
  const failed = Number(failedAttempts);
  if (failedAttempts == null || !Number.isInteger(failed) || failed < 1 || failed >= PIN_MAX_ATTEMPTS) return base;
  const left = PIN_MAX_ATTEMPTS - failed;
  return `${base}. ${left} ${left === 1 ? "try" : "tries"} left before it locks.`;
}

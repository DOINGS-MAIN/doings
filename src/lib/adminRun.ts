// Small helpers for admin actions. Kept free of React so they can be tested on their own.

/**
 * Runs an admin action, then refreshes what it touched. After a success the refresh is waited for,
 * so the page is up to date when the dialog closes. After a failure the refresh still starts (the
 * server may have done part of the action before failing, and the page must not keep showing the old
 * state) and the error is passed on. A refresh that fails never turns a done action into an error.
 */
export async function runThenRefresh<T>(call: () => Promise<T>, refresh: () => Promise<unknown>): Promise<T> {
  let out: T;
  try {
    out = await call();
  } catch (err) {
    void refresh().catch(() => undefined);
    throw err;
  }
  await refresh().catch(() => undefined);
  return out;
}

/** Waits for a best-effort call, but never longer than `ms` and never throws. */
export function withinTime(call: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    call.then(done, done);
  });
}

/** The download name of a CSV export: the list and the UTC day (times inside the file are UTC too). */
export function exportFileName(path: string, now: Date = new Date()): string {
  return `${path.replace(/\//g, "-")}-${now.toISOString().slice(0, 10)}.csv`;
}

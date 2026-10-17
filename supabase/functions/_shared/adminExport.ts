// Complete CSV exports: walk a query in fixed chunks up to a cap. One extra row past the cap is
// fetched so "exactly the cap" and "more than the cap" can be told apart.
export const EXPORT_CHUNK = 1000;
export const EXPORT_CAP = 50000;

export async function collectAll<T>(
  fetchRange: (from: number, to: number) => Promise<T[]>,
  opts: { chunk?: number; cap?: number } = {},
): Promise<{ rows: T[]; truncated: boolean }> {
  const chunk = opts.chunk ?? EXPORT_CHUNK;
  const cap = opts.cap ?? EXPORT_CAP;
  const rows: T[] = [];
  for (let from = 0; from <= cap; from += chunk) {
    const to = Math.min(from + chunk - 1, cap); // index `cap` is the probe row
    const batch = await fetchRange(from, to);
    rows.push(...batch);
    if (batch.length < to - from + 1) break;
  }
  const truncated = rows.length > cap;
  return { rows: truncated ? rows.slice(0, cap) : rows, truncated };
}

// Splits ids into groups so each .in() lookup keeps its URL short (150 UUIDs ≈ 5.6 KB).
export const IN_CHUNK = 150;

export function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

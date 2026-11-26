/** How many rows each person has, keyed by the column that holds their id (events hosted, events joined). */
export function countByUser(rows: Record<string, unknown>[] | null | undefined, key: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    const id = row[key];
    if (typeof id === "string" && id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

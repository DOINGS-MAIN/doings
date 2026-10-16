// Safe admin search and paging. PostgREST `.or()` filters are strings, so user text must be
// quoted (commas and brackets are syntax) and LIKE-escaped (% and _ are wildcards).
export const SEARCH_MAX = 100;

export function cleanSearch(text: string | null | undefined): string {
  return (text ?? "").trim().slice(0, SEARCH_MAX);
}

export function orIlike(columns: string[], text: string | null | undefined): string {
  const clean = cleanSearch(text);
  if (!clean) return "";
  const like = `%${clean.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const quoted = `"${like.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
  return columns.map((col) => `${col}.ilike.${quoted}`).join(",");
}

export function parsePaging(
  params: URLSearchParams,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): { page: number; limit: number; from: number; to: number } {
  const defaultLimit = opts.defaultLimit ?? 50;
  const maxLimit = opts.maxLimit ?? 100;
  const int = (raw: string | null) => {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 1 ? n : null;
  };
  const page = int(params.get("page")) ?? 1;
  const limit = Math.min(int(params.get("limit")) ?? defaultLimit, maxLimit);
  const from = (page - 1) * limit;
  return { page, limit, from, to: from + limit - 1 };
}

// A value for an exact-match condition inside `.or()` (e.g. `reference.eq.<value>`), quoted so
// commas, brackets and quotes in it stay literal.
export function quoteValue(value: string): string {
  return `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

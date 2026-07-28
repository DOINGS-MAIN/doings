/** Readable message from Supabase/PostgREST errors (avoid `String(err) === "[object Object]"`). */
export function formatDbError(error: unknown): string {
  if (error == null) return "Unknown error";
  if (typeof error === "string") return error;
  if (typeof error !== "object") return String(error);

  const e = error as { message?: string; code?: string; details?: string; hint?: string };
  const parts = [e.message, e.details, e.hint, e.code].filter(
    (part) => typeof part === "string" && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" — ") : "Unknown error";
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  if (code === "23505") return true;
  const message = (error as { message?: string }).message ?? "";
  return /duplicate key|unique constraint/i.test(message);
}

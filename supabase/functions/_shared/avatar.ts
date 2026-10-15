/** Dance floor avatars: checks for uploads to the streamoji function (DOINGSNEWFACE 2026-10-15-dance-floor-avatars-design.md). */
export const MAX_FLOOR_BYTES = 2_621_440;
const MOVE = /^[a-z0-9-]{1,40}$/;

type Check = { ok: true } | { ok: false; code: "invalid_model" | "too_large"; error: string };
const invalid: Check = { ok: false, code: "invalid_model", error: "That isn't a valid avatar file" };

export function validateFloorGlb(bytes: Uint8Array): Check {
  if (bytes.byteLength > MAX_FLOOR_BYTES) return { ok: false, code: "too_large", error: "Avatar file is too large" };
  if (bytes.byteLength < 20) return invalid;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) return invalid;
  if (dv.getUint32(8, true) !== bytes.byteLength) return invalid;
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLen > bytes.byteLength) return invalid;
  let json: { skins?: unknown; nodes?: unknown };
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  } catch {
    return invalid;
  }
  if (!Array.isArray(json.skins) || json.skins.length === 0) return invalid;
  if (!Array.isArray(json.nodes) || !json.nodes.some((n) => (n as { name?: unknown })?.name === "Hips")) return invalid;
  return { ok: true };
}

export function validateMoves(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const m of raw) {
    if (typeof m !== "string" || !MOVE.test(m)) return null;
    if (!out.includes(m)) out.push(m);
  }
  return out.length > 3 ? null : out;
}

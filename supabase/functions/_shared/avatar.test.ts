import { assertEquals } from "jsr:@std/assert";
import { MAX_FLOOR_BYTES, validateFloorGlb, validateMoves } from "./avatar.ts";

function glb(json: unknown, opts: { magic?: number; version?: number; lie?: number; pad?: number } = {}) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(text.length / 4) * 4;
  const total = 12 + 8 + jsonLen + (opts.pad ?? 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, opts.magic ?? 0x46546c67, true);
  dv.setUint32(4, opts.version ?? 2, true);
  dv.setUint32(8, opts.lie ?? total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + jsonLen);
  return out;
}
const good = { asset: { version: "2.0" }, nodes: [{ name: "Hips" }], skins: [{ joints: [0] }] };

Deno.test("validateFloorGlb accepts a skinned avatar", () => {
  assertEquals(validateFloorGlb(glb(good)), { ok: true });
});

Deno.test("validateFloorGlb rejects bad files (Review Focus 2)", () => {
  const bad = (b: Uint8Array) => (validateFloorGlb(b) as { code?: string }).code;
  assertEquals(bad(glb(good, { magic: 0x12345678 })), "invalid_model");
  assertEquals(bad(glb(good, { version: 1 })), "invalid_model");
  assertEquals(bad(glb(good, { lie: 999 })), "invalid_model");
  assertEquals(bad(glb({ ...good, skins: [] })), "invalid_model");
  assertEquals(bad(glb({ ...good, nodes: [{ name: "Root" }] })), "invalid_model");
  assertEquals(bad(new Uint8Array(10)), "invalid_model");
  assertEquals(bad(glb(good, { pad: MAX_FLOOR_BYTES })), "too_large");
  const broken = glb(good); broken[20] = 0x7b; broken[21] = 0x7b;
  assertEquals(bad(broken), "invalid_model");
});

Deno.test("validateMoves", () => {
  assertEquals(validateMoves(["hip-hop", "samba"]), ["hip-hop", "samba"]);
  assertEquals(validateMoves(["samba", "samba"]), ["samba"]);
  assertEquals(validateMoves([]), []);
  assertEquals(validateMoves(["a", "b", "c", "d"]), null);
  assertEquals(validateMoves(["Hip Hop"]), null);
  assertEquals(validateMoves("hip-hop"), null);
  assertEquals(validateMoves([1]), null);
});

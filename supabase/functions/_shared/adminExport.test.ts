import { assertEquals } from "jsr:@std/assert";
import { collectAll } from "./adminExport.ts";

const source = (n: number) => {
  const calls: [number, number][] = [];
  const fetchRange = async (from: number, to: number) => {
    calls.push([from, to]);
    return Array.from({ length: Math.max(0, Math.min(to, n - 1) - from + 1) }, (_, i) => from + i);
  };
  return { calls, fetchRange };
};

Deno.test("collectAll walks chunks until a short chunk", async () => {
  const s = source(2500);
  const r = await collectAll(s.fetchRange, { chunk: 1000, cap: 50000 });
  assertEquals(r.rows.length, 2500);
  assertEquals(r.truncated, false);
  assertEquals(s.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

Deno.test("collectAll handles an exact multiple and empty sources", async () => {
  const exact = source(2000);
  const r = await collectAll(exact.fetchRange, { chunk: 1000, cap: 50000 });
  assertEquals([r.rows.length, r.truncated], [2000, false]);
  const empty = await collectAll(source(0).fetchRange, { chunk: 1000, cap: 50000 });
  assertEquals([empty.rows.length, empty.truncated], [0, false]);
});

Deno.test("collectAll stops at the cap and reports truncation", async () => {
  const s = source(10);
  const r = await collectAll(s.fetchRange, { chunk: 3, cap: 7 });
  assertEquals(r.rows, [0, 1, 2, 3, 4, 5, 6]);
  assertEquals(r.truncated, true);
});

Deno.test("collectAll is not truncated when the source is exactly the cap", async () => {
  const r = await collectAll(source(6).fetchRange, { chunk: 3, cap: 6 });
  assertEquals([r.rows.length, r.truncated], [6, false]);
});

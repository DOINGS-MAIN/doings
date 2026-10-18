import { assertEquals } from "jsr:@std/assert";
import { floorHoldMoney } from "./floorMoney.ts";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const base = { planned_amount_kobo: 200000, note_count: 10, denomination: 200, floor_seconds: 60,
  floor_started_at: new Date(NOW - 30_000).toISOString(), transfer_id: null, charged_amount_kobo: null };

Deno.test("paid on stepping on (101): nothing held, charged = the full amount", () => {
  assertEquals(floorHoldMoney({ ...base, transfer_id: "t1", charged_amount_kobo: 200000 }, NOW),
    { paid: true, charged_so_far_kobo: 200000, held_kobo: 0 });
});

Deno.test("legacy on-floor hold: still held, charged by the time danced", () => {
  assertEquals(floorHoldMoney(base, NOW), { paid: false, charged_so_far_kobo: 100000, held_kobo: 200000 });
});

Deno.test("queued or classic pending hold: all held, nothing charged", () => {
  assertEquals(floorHoldMoney({ ...base, floor_started_at: null, floor_seconds: null }, NOW),
    { paid: false, charged_so_far_kobo: 0, held_kobo: 200000 });
});

import { assertEquals } from "jsr:@std/assert";
import { deletePlan } from "./eventDelete.ts";

Deno.test("an event that never went live is removed outright", () => {
  assertEquals(deletePlan("draft"), { remove: true });
});

Deno.test("a live event is ended first, then marked deleted", () => {
  const now = "2026-11-30T10:00:00.000Z";
  assertEquals(deletePlan("live", now), { remove: false, patch: { status: "ended", ended_at: now, deleted_at: now } });
});

Deno.test("an ended event keeps its end time and is marked deleted", () => {
  const now = "2026-11-30T10:00:00.000Z";
  assertEquals(deletePlan("ended", now), { remove: false, patch: { deleted_at: now } });
});

Deno.test("a scheduled event is closed and marked deleted", () => {
  const now = "2026-11-30T10:00:00.000Z";
  assertEquals(deletePlan("scheduled", now), { remove: false, patch: { status: "ended", ended_at: now, deleted_at: now } });
});

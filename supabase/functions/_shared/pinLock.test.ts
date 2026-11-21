import { assertEquals } from "jsr:@std/assert";
import { pinLockedMessage, pinWrongMessage } from "./pinLock.ts";

const now = new Date("2026-11-14T12:00:00Z");
const inMs = (ms: number) => new Date(now.getTime() + ms).toISOString();
const MIN = 60_000;
const lead = "Too many incorrect PIN attempts. ";

Deno.test("pinLockedMessage: says how long the lock really lasts", () => {
  assertEquals(pinLockedMessage(inMs(15 * MIN), now), lead + "Try again in 15 minutes.");
  assertEquals(pinLockedMessage(inMs(60 * MIN), now), lead + "Try again in 1 hour.");
  assertEquals(pinLockedMessage(inMs(6 * 60 * MIN), now), lead + "Try again in 6 hours.");
  assertEquals(pinLockedMessage(inMs(24 * 60 * MIN), now), lead + "Try again in 24 hours.");
});

Deno.test("pinLockedMessage: part-way through a lock it rounds up, never promising too early", () => {
  assertEquals(pinLockedMessage(inMs(14 * MIN + 1), now), lead + "Try again in 15 minutes.");
  assertEquals(pinLockedMessage(inMs(30_000), now), lead + "Try again in 1 minute.");
  assertEquals(pinLockedMessage(inMs(61 * MIN), now), lead + "Try again in 2 hours.");
  assertEquals(pinLockedMessage(inMs(5 * 60 * MIN + 1), now), lead + "Try again in 6 hours.");
});

Deno.test("pinLockedMessage: without a usable time it does not name one", () => {
  assertEquals(pinLockedMessage(null, now), lead + "Try again later.");
  assertEquals(pinLockedMessage("not a date", now), lead + "Try again later.");
  assertEquals(pinLockedMessage(inMs(-5 * MIN), now), lead + "Try again later.");
});

Deno.test("pinWrongMessage: says how many tries are left before the lock", () => {
  assertEquals(pinWrongMessage(1), "Incorrect transaction PIN. 4 tries left before it locks.");
  assertEquals(pinWrongMessage(3), "Incorrect transaction PIN. 2 tries left before it locks.");
  assertEquals(pinWrongMessage(4), "Incorrect transaction PIN. 1 try left before it locks.");
});

Deno.test("pinWrongMessage: no count when it is not known", () => {
  assertEquals(pinWrongMessage(null), "Incorrect transaction PIN");
  assertEquals(pinWrongMessage(undefined), "Incorrect transaction PIN");
  assertEquals(pinWrongMessage(0), "Incorrect transaction PIN");
  assertEquals(pinWrongMessage(5), "Incorrect transaction PIN");
  assertEquals(pinWrongMessage(Number.NaN), "Incorrect transaction PIN");
});

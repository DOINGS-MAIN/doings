import { assertEquals } from "jsr:@std/assert";
import { floorErrorResponse, parseFloorAction } from "./floor.ts";

const EV = "11111111-1111-4111-8111-111111111101";
const HOLD = "22222222-2222-4222-8222-222222222202";

Deno.test("parseFloorAction: queue", () => {
  assertEquals(parseFloorAction({ action: "queue", event_id: EV, amount: 50000, denomination: 200, pin: "1234" }), {
    action: "queue", eventId: EV, amount: 50000, denomination: 200, pin: "1234",
  });
  assertEquals(parseFloorAction({ action: "queue", event_id: EV, amount: 50100, denomination: 200, pin: "1234" }), {
    error: "amount must be a positive multiple of the denomination",
  });
  assertEquals(parseFloorAction({ action: "queue", event_id: EV, amount: 1000, denomination: 300, pin: "1234" }), {
    error: "denomination must be 200, 500, or 1000",
  });
  assertEquals(parseFloorAction({ action: "queue", event_id: "nope", amount: 1000, denomination: 200, pin: "1" }), {
    error: "event_id is required",
  });
  assertEquals(parseFloorAction({ action: "queue", event_id: EV, amount: 1000, denomination: 200 }), { error: "pin is required" });
});

Deno.test("parseFloorAction: stop and leave", () => {
  assertEquals(parseFloorAction({ action: "stop", hold_id: HOLD }), { action: "stop", holdId: HOLD });
  assertEquals(parseFloorAction({ action: "leave", hold_id: HOLD }), { action: "leave", holdId: HOLD });
  assertEquals(parseFloorAction({ action: "stop" }), { error: "hold_id is required" });
  assertEquals(parseFloorAction({ action: "dance" }), { error: "Unknown action" });
});

Deno.test("floorErrorResponse maps database errors", () => {
  assertEquals(floorErrorResponse("FLOOR_ALREADY_IN"), {
    status: 409, error: "You already have a spray in line or on the floor", code: "FLOOR_ALREADY_IN",
  });
  assertEquals(floorErrorResponse("Event is not live"), { status: 400, error: "Event is not live", code: "EVENT_NOT_LIVE" });
  assertEquals(floorErrorResponse("Insufficient balance"), { status: 400, error: "Insufficient balance" });
  assertEquals(floorErrorResponse("Host cannot spray own event"), { status: 400, error: "Host cannot spray own event" });
  assertEquals(floorErrorResponse("Not authorized for this spray hold"), { status: 403, error: "Not authorized for this spray" });
  assertEquals(floorErrorResponse("Spray hold not found"), { status: 404, error: "Spray not found" });
  assertEquals(floorErrorResponse("boom"), { status: 500, error: "Spray failed" });
});

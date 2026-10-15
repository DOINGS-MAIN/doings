/** Dance floor requests on the spray function (spec: DOINGSNEWFACE 2026-10-15-dance-floor-queue-design.md). */
export type FloorAction =
  | { action: "queue"; eventId: string; amount: number; denomination: 200 | 500 | 1000; pin: string }
  | { action: "stop" | "leave"; holdId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFloorAction(body: Record<string, unknown>): FloorAction | { error: string } {
  const action = body.action;
  if (action === "stop" || action === "leave") {
    return typeof body.hold_id === "string" && UUID.test(body.hold_id)
      ? { action, holdId: body.hold_id }
      : { error: "hold_id is required" };
  }
  if (action !== "queue") return { error: "Unknown action" };
  if (typeof body.event_id !== "string" || !UUID.test(body.event_id)) return { error: "event_id is required" };
  const denomination = Number(body.denomination);
  if (denomination !== 200 && denomination !== 500 && denomination !== 1000) {
    return { error: "denomination must be 200, 500, or 1000" };
  }
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount % denomination !== 0) {
    return { error: "amount must be a positive multiple of the denomination" };
  }
  if (typeof body.pin !== "string") return { error: "pin is required" };
  return { action, eventId: body.event_id, amount, denomination, pin: body.pin };
}

export function floorErrorResponse(message: string): { status: number; error: string; code?: string } {
  if (message.includes("FLOOR_ALREADY_IN")) {
    return { status: 409, error: "You already have a spray in line or on the floor", code: "FLOOR_ALREADY_IN" };
  }
  if (message.includes("Event is not live")) return { status: 400, error: "Event is not live", code: "EVENT_NOT_LIVE" };
  if (message.includes("Insufficient balance")) return { status: 400, error: "Insufficient balance" };
  if (message.includes("Host cannot spray")) return { status: 400, error: "Host cannot spray own event" };
  if (message.includes("Not authorized")) return { status: 403, error: "Not authorized for this spray" };
  if (message.includes("not found")) return { status: 404, error: "Spray not found" };
  return { status: 500, error: "Spray failed" };
}

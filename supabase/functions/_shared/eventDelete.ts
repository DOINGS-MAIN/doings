// What "delete" does to an event, by its status.
// An event that never went live has nothing attached and is removed outright. Anything else has (or
// may have) sprays, giveaways and guests, so it is kept and marked deleted: it leaves every list and
// link (migration 121) while people's history stays. A live event is ended in the same write, which
// settles the floor and tells the room (the events table's end trigger).
export type DeletePlan =
  | { remove: true }
  | { remove: false; patch: { status?: "ended"; ended_at?: string; deleted_at: string } };

export function deletePlan(status: string, now = new Date().toISOString()): DeletePlan {
  if (status === "draft") return { remove: true };
  if (status === "ended") return { remove: false, patch: { deleted_at: now } };
  return { remove: false, patch: { status: "ended", ended_at: now, deleted_at: now } };
}

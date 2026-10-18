/** Money view of one active spray hold for the admin live-event page (migrations 088, 101). */
export type HoldMoneyRow = {
  planned_amount_kobo: unknown;
  note_count?: unknown;
  denomination?: unknown;
  floor_seconds?: unknown;
  floor_started_at?: unknown;
  transfer_id?: unknown;
  charged_amount_kobo?: unknown;
};

/**
 * paid: charged in full on stepping onto the floor (101) — nothing is held any more.
 * Otherwise (queued, classic pending, or a legacy pre-101 floor hold) the planned amount is held, and a
 * legacy floor hold's charge so far follows floor_charged_kobo: whole notes for the share danced.
 */
export function floorHoldMoney(h: HoldMoneyRow, nowMs: number): { paid: boolean; charged_so_far_kobo: number; held_kobo: number } {
  const planned = Number(h.planned_amount_kobo ?? 0);
  if (h.transfer_id) return { paid: true, charged_so_far_kobo: Number(h.charged_amount_kobo ?? planned), held_kobo: 0 };
  const secs = Number(h.floor_seconds ?? 0);
  if (!h.floor_started_at || !secs) return { paid: false, charged_so_far_kobo: 0, held_kobo: planned };
  const ms = Math.min(Math.max(nowMs - new Date(h.floor_started_at as string).getTime(), 0), secs * 1000);
  const notes = Math.floor((Number(h.note_count ?? 0) * ms) / (secs * 1000));
  return { paid: false, charged_so_far_kobo: notes * Number(h.denomination ?? 0) * 100, held_kobo: planned };
}

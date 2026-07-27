/** Deno mirror of src/lib/sprayTheatrePlan.ts — keep in sync. */

export type SprayCurrency = "NGN" | "USDC";
export type SprayDenominationNgn = 200 | 500 | 1000;

export interface QueueCompressionTier {
  min_queue: number;
  multiplier: number;
}

export interface SprayTheatreSettings {
  stage_min_per_100k_denom_200: number;
  stage_min_per_100k_denom_500: number;
  stage_min_per_100k_denom_1000: number;
  stage_min_per_100_usdc: number;
  max_single_spray_ngn: number;
  max_single_spray_ngn_kobo: number;
  guest_session_cap_sec: number;
  max_stage_sec: number;
  queue_compression_tiers: QueueCompressionTier[];
}

export interface SprayTheatrePlan {
  currency: SprayCurrency;
  amount: number;
  denomination: number;
  note_count: number;
  planned_amount: number;
  benchmark_units: number;
  benchmark_minutes: number;
  base_stage_min: number;
  base_stage_sec: number;
  session_duration_sec: number;
  note_interval_sec: number;
  raw_session_sec: number;
  queue_compression_tiers: QueueCompressionTier[];
}

const NOTE_INTERVAL_FLOOR_SEC = 0.05;

const DEFAULT_TIERS: QueueCompressionTier[] = [
  { min_queue: 0, multiplier: 1 },
  { min_queue: 10, multiplier: 0.85 },
  { min_queue: 50, multiplier: 0.55 },
  { min_queue: 100, multiplier: 0.35 },
];

export function parseSprayTheatreSettingsRow(row: Record<string, unknown>): SprayTheatreSettings {
  let tiers = DEFAULT_TIERS;
  if (Array.isArray(row.spray_queue_compression_tiers)) {
    tiers = row.spray_queue_compression_tiers as QueueCompressionTier[];
  }

  const maxKobo = Number(row.spray_max_single_ngn_kobo ?? 100_000_000);

  return {
    stage_min_per_100k_denom_200: Number(row.spray_stage_min_per_100k_denom_200 ?? 3),
    stage_min_per_100k_denom_500: Number(row.spray_stage_min_per_100k_denom_500 ?? 2.5),
    stage_min_per_100k_denom_1000: Number(row.spray_stage_min_per_100k_denom_1000 ?? 2),
    stage_min_per_100_usdc: Number(row.spray_stage_min_per_100_usdc ?? 4),
    max_single_spray_ngn: maxKobo / 100,
    max_single_spray_ngn_kobo: maxKobo,
    guest_session_cap_sec: Number(row.spray_guest_session_cap_sec ?? 180),
    max_stage_sec: Number(row.spray_max_stage_sec ?? 2700),
    queue_compression_tiers: tiers,
  };
}

function benchmarkMinutesForDenom(settings: SprayTheatreSettings, denomination: number): number {
  switch (denomination) {
    case 200:
      return settings.stage_min_per_100k_denom_200;
    case 500:
      return settings.stage_min_per_100k_denom_500;
    case 1000:
      return settings.stage_min_per_100k_denom_1000;
    default:
      return settings.stage_min_per_100k_denom_200;
  }
}

export function computeSprayTheatrePlan(
  settings: SprayTheatreSettings,
  amount: number,
  denomination: SprayDenominationNgn,
  currency: SprayCurrency = "NGN",
): SprayTheatrePlan {
  if (amount <= 0) throw new Error("amount must be positive");
  if (amount % denomination !== 0) throw new Error("amount must be divisible by denomination");

  const noteCount = amount / denomination;
  const benchmarkMinutes = benchmarkMinutesForDenom(settings, denomination);
  const benchmarkUnits = amount / 100_000;
  const baseStageMin = benchmarkMinutes * benchmarkUnits;
  const baseStageSecUncapped = Math.round(baseStageMin * 60);
  const baseStageSec = Math.min(baseStageSecUncapped, settings.max_stage_sec);

  const rawSessionSec = noteCount;
  const sessionDurationSec = Math.min(rawSessionSec, settings.guest_session_cap_sec);
  const noteIntervalSec = Math.max(sessionDurationSec / noteCount, NOTE_INTERVAL_FLOOR_SEC);

  return {
    currency,
    amount,
    denomination,
    note_count: noteCount,
    planned_amount: amount,
    benchmark_units: benchmarkUnits,
    benchmark_minutes: benchmarkMinutes,
    base_stage_min: baseStageMin,
    base_stage_sec: baseStageSec,
    session_duration_sec: sessionDurationSec,
    note_interval_sec: noteIntervalSec,
    raw_session_sec: rawSessionSec,
    queue_compression_tiers: settings.queue_compression_tiers,
  };
}

export function theatrePlanToMetadata(plan: SprayTheatrePlan): Record<string, unknown> {
  return {
    theatre_version: 1,
    currency: plan.currency,
    amount: plan.amount,
    denomination: plan.denomination,
    note_count: plan.note_count,
    planned_amount: plan.planned_amount,
    benchmark_units: plan.benchmark_units,
    benchmark_minutes: plan.benchmark_minutes,
    base_stage_min: plan.base_stage_min,
    base_stage_sec: plan.base_stage_sec,
    session_duration_sec: plan.session_duration_sec,
    note_interval_sec: plan.note_interval_sec,
    raw_session_sec: plan.raw_session_sec,
    queue_compression_tiers: plan.queue_compression_tiers,
  };
}

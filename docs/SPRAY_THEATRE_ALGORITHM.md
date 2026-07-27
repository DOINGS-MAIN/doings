# Spray theatre algorithm

Status: **Phase 1–2 implemented locally** — Phase 3 (projector stage) and Phase 4 (USDC) pending deploy + migration.

---

## Locked product decisions

| Decision | Value |
|----------|--------|
| Auto-stop at session cap | **Charge full planned amount** (not elapsed portion). Requires **hold upfront** at spray start (see `docs/TODO.md`). |
| Host receives USDC | **USDC as USDC** (no auto-convert to NGN at spray time). |
| Max single spray (default) | **₦1,000,000** NGN (and USDC equivalent via FX at validate — TBD cap in USDC units). |
| Stage time model | **Admin benchmark per ₦100k / 100 USDC**, scaled linearly by amount multiple. |
| Queue pressure | **System algorithm** — reduce stage time by tiered % as queue depth grows (10 / 50 / 100+ people). |

---

## The problem (why not 1 note/sec everywhere)

| Layer | Today | Target |
|-------|--------|--------|
| Guest phone | 1 note/sec → huge sprays take hours | Capped session; fast rain; **full amount on auto-stop** |
| Projector | Fixed ~6 s | **Minutes** from admin benchmarks × amount |
| Queue | FIFO, no compression | Same order; **shorter turns** when crowded |

---

## Core idea: ₦100k / 100 USDC benchmarks

Admins configure **how many minutes of stage time one benchmark block earns**:

| Admin key | Meaning | Example default |
|-----------|---------|-----------------|
| `stage_min_per_100k_denom_200` | ₦100,000 sprayed as ₦200 notes | 3 min |
| `stage_min_per_100k_denom_500` | ₦100,000 as ₦500 notes | 2.5 min |
| `stage_min_per_100k_denom_1000` | ₦100,000 as ₦1,000 notes | 2 min |
| `stage_min_per_100_usdc` | 100 USDC (any USDC note mix) | 4 min |

Defaults are placeholders — **all configurable in admin**.

### Stage duration (before queue)

**NGN:**

```
units       = amount_ngn / 100_000
benchmarkMin = admin[`stage_min_per_100k_denom_${denomination}`]
baseStageMin = benchmarkMin × units
baseStageSec = baseStageMin × 60
```

**USDC:**

```
units        = amount_usdc / 100
benchmarkMin = admin[`stage_min_per_100_usdc`]
baseStageSec = benchmarkMin × units × 60
```

### Examples (using example defaults above)

| Spray | units | baseStage |
|-------|-------|-----------|
| ₦100k @ ₦200 | 1 | 3 min |
| ₦1M @ ₦200 | 10 | **30 min** |
| ₦500k @ ₦1,000 | 5 | 10 min |
| 250 USDC | 2.5 | 10 min |

Denomination is encoded in the **benchmark key**, not a separate multiplier — ₦100k @ ₦1,000 vs ₦100k @ ₦200 can have different admin minutes to reflect “bigger notes = more prestige.”

Store `baseStageSec` on `spray_records.metadata` at record time so replay/projector stays consistent.

---

## Queue compression (system algorithm)

**FIFO order is unchanged** — everyone gets a turn; only **duration** shrinks when the line is long.

`queueDepth` = number of sprayers **waiting** for stage (not counting 3 active slots).

### Tier table (admin-configurable)

| Queue waiting (≥) | Time multiplier | Reduction |
|-------------------|-----------------|-----------|
| 0 | 1.00 | 0% |
| 10 | 0.85 | 15% |
| 50 | 0.55 | 45% |
| 100 | 0.35 | 65% |

Between tiers: **linear interpolation** on multiplier (smooth steps, no cliffs).

```
queueMultiplier = interpolate(queueDepth, tiers)   // floor at e.g. 0.25 global min
effectiveStageSec = baseStageSec × queueMultiplier
```

| baseStage | queue=0 | queue=10 | queue=50 | queue=100 |
|-----------|---------|----------|----------|-----------|
| 30 min | 30 min | 25.5 min | 16.5 min | 10.5 min |

Projector applies `queueMultiplier` **live** when promoting to stage (queue grows → active slot can end early on next tick, or pre-compute at promotion — implementation detail). Stored metadata keeps `baseStageSec`; log `appliedQueueMultiplier` at show time.

Optional future: per-event override tiers; global defaults in `platform_settings`.

---

## Guest session (phone)

Separate from stage minutes but tied to payment policy.

```
TARGET_SESSION_SEC = admin.guest_spray_session_cap_sec   // e.g. 180
rawDuration        = noteCount × 1.0
sessionDuration    = min(rawDuration, TARGET_SESSION_SEC)
noteIntervalSec    = sessionDuration / noteCount
```

**Auto-stop:** when `sessionDuration` elapses → auto-complete spray API with **full planned amount** (hold must already cover planned amount).

**Pause / Stop:** unchanged — Stop records partial only if user stops early; auto-stop records **full**.

---

## USDC sprays

- Guest selects **USDC wallet**; host credited **USDC**.
- Distinct bill art (silver/cyan, USDC label).
- Stage time from **`stage_min_per_100_usdc`** × `(amount_usdc / 100)`.
- Store FX snapshot in metadata for display (“≈ ₦X”) only — **not** for host settlement.
- Extend `record_event_spray` (or parallel RPC) for `currency = 'USDC'`, USDC wallet legs.

---

## Limits & guards

| Guard | Value |
|-------|--------|
| Max single spray (default) | ₦1,000,000 |
| Stage slots on projector | 3 concurrent |
| Queue order | FIFO by `sprayed_at` |
| Min stage (optional) | e.g. 30 s — avoid flash |
| Max stage (optional) | e.g. 45 min — safety cap even with no queue |

Host-level max spray override (future): optional per event.

---

## Admin settings (implementation target)

Extend `platform_settings` or new `spray_theatre_settings` row:

```sql
-- minutes per benchmark block
spray_stage_min_per_100k_denom_200   NUMERIC
spray_stage_min_per_100k_denom_500   NUMERIC
spray_stage_min_per_100k_denom_1000  NUMERIC
spray_stage_min_per_100_usdc         NUMERIC

-- limits
spray_max_single_ngn                 BIGINT  DEFAULT 100000000  -- kobo
spray_guest_session_cap_sec          INT     DEFAULT 180

-- queue tiers (JSONB array of {min_queue, multiplier})
spray_queue_compression_tiers        JSONB   DEFAULT '[{"min":0,"mult":1},{"min":10,"mult":0.85},{"min":50,"mult":0.55},{"min":100,"mult":0.35}]'
```

Admin UI: Finance/Settings page — “Spray theatre” section.

---

## SprayTheatrePlan (compute at validate)

```ts
interface SprayTheatrePlan {
  currency: "NGN" | "USDC";
  amount: number;
  denomination: number;
  noteCount: number;
  plannedAmount: number;           // full charge on auto-stop
  sessionDurationSec: number;
  noteIntervalSec: number;
  baseStageSec: number;
  queueCompressionTiers: QueueTier[];
  fxSnapshot?: { usdc_ngn_rate: number }; // display only
}
```

1. **validate** — compute plan, hold full planned amount, return plan to client.
2. **record** — persist plan fields on `spray_records.metadata`.
3. **projector** — `useSprayStage` uses `baseStageSec × queueMultiplier(depth)`.

---

## References (current code)

- Phone: `SprayAnimation.tsx`
- Stage: `useSprayStage.ts` (hard-coded 6 s — replace)
- API: `supabase/functions/spray/index.ts`, `record_event_spray`
- Admin pattern: `platform_settings`, `get_fx_admin_settings` / Admin FX UI

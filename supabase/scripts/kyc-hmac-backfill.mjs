#!/usr/bin/env node
// One-off (migration 084 → 085): fill kyc_verifications.bvn_hmac / nin_hmac from the server-only payloads.
// Dry run by default; pass --apply to write. Prints no ID numbers.
// SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… KYC_HASH_SECRET=… node kyc-hmac-backfill.mjs [--apply]
import { createHmac } from "node:crypto";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY, KYC_HASH_SECRET: SECRET } = process.env;
if (!SUPABASE_URL || !KEY || !SECRET) {
  console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and KYC_HASH_SECRET");
  process.exit(1);
}
const apply = process.argv.includes("--apply");

// Same vector as _shared/kycHash.test.ts, so this script and the edge function provably agree.
const VECTOR = "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";
if (createHmac("sha256", "key").update("The quick brown fox jumps over the lazy dog").digest("hex") !== VECTOR) {
  throw new Error("HMAC self-check failed");
}
const hmac = (v) => createHmac("sha256", SECRET).update(v).digest("hex");

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path.split("?")[0]} → ${res.status}`);
  return res.status === 204 ? null : res.json();
}

/** 11-digit number from a Dojah lookup reply ({entity:{bvn}} / {data:{nin}} / flat). */
function idFrom(part, fields) {
  const obj = part?.entity ?? part?.data ?? part ?? {};
  for (const f of fields) {
    const digits = String(obj[f] ?? "").replace(/\D/g, "");
    if (digits.length === 11) return digits;
  }
  return null;
}

const rows = await rest(
  "kyc_verifications?select=id,bvn_last_four,nin_last_four,bvn_hmac,nin_hmac&level=eq.2&order=created_at",
);
const payloads = new Map(
  (await rest("kyc_verification_payloads?select=kyc_id,payload")).map((p) => [p.kyc_id, p.payload]),
);

const tally = { updated: 0, already: 0, noPayload: 0, noBvn: 0, lastFourMismatch: 0 };
for (const row of rows) {
  if (row.bvn_hmac) {
    tally.already++;
    continue;
  }
  const payload = payloads.get(row.id);
  if (!payload) {
    tally.noPayload++;
    console.log(`${row.id.slice(0, 8)} no payload`);
    continue;
  }
  const bvn = idFrom(payload.bvn, ["bvn", "BVN"]);
  const nin = idFrom(payload.nin, ["nin", "NIN", "nin_number"]);
  if (!bvn) {
    tally.noBvn++;
    console.log(`${row.id.slice(0, 8)} no BVN in payload`);
    continue;
  }
  if (row.bvn_last_four && bvn.slice(-4) !== row.bvn_last_four) {
    tally.lastFourMismatch++;
    console.log(`${row.id.slice(0, 8)} BVN last four mismatch, skipped`);
    continue;
  }
  const patch = { bvn_hmac: hmac(bvn) };
  if (nin && (!row.nin_last_four || nin.slice(-4) === row.nin_last_four)) patch.nin_hmac = hmac(nin);
  if (apply) await rest(`kyc_verifications?id=eq.${row.id}`, { method: "PATCH", body: JSON.stringify(patch) });
  tally.updated++;
  console.log(`${row.id.slice(0, 8)} ${apply ? "updated" : "would update"}${patch.nin_hmac ? " (+nin)" : ""}`);
}
console.log(apply ? "APPLIED" : "DRY RUN", tally);

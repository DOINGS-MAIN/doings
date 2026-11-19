// What a person must do to sell follows two admin switches (migration 114): BVN, selfie, both or
// neither. kycSelfie.ts is the BVN + selfie check; this file adds the two single checks and the
// rule that picks one. Pure: kyc-dojah-verify wires the deps. Never log the BVN, the selfie or
// Dojah bodies.
import { type DojahCall, parseDojahIdentityEntity } from "./dojahClient.ts";
import {
  fail,
  isJpegBase64Within,
  isoDateOrNull,
  livenessSaysNo,
  parseLiveness,
  SELFIE_MAX_BYTES,
  type VerifyDeps,
  type VerifyOutcome,
} from "./kycSelfie.ts";

/** public.sell_identity_status(): what selling needs now, and what this person has done. */
export type SellIdentity = { needs_bvn: boolean; needs_selfie: boolean; has_bvn: boolean; has_selfie: boolean };

export type KycPlan = "bvn_selfie" | "bvn" | "selfie" | "none";

/**
 * The check to run. When both are required they are always done together, even if one is already
 * on file: only the face match against the BVN photo ties a selfie to a BVN.
 */
export function kycPlan(s: SellIdentity): KycPlan {
  if (s.needs_bvn && s.needs_selfie) return s.has_bvn && s.has_selfie ? "none" : "bvn_selfie";
  if (s.needs_bvn) return s.has_bvn ? "none" : "bvn";
  if (s.needs_selfie) return s.has_selfie ? "none" : "selfie";
  return "none";
}

export type KycRecord = {
  method: "bvn" | "selfie";
  /** 2 for a BVN (it says who the person is); 1 for a selfie alone (it only says a person is there). */
  level: 1 | 2;
  bvn_hmac: string | null;
  bvn_last_four: string | null;
  bvn_first_name: string | null;
  bvn_middle_name: string | null;
  bvn_last_name: string | null;
  bvn_dob: string | null;
  liveness_score: number | null;
  selfie_match_confidence: number | null;
};

export type ModeDeps = Omit<VerifyDeps, "bvnSelfie" | "insertVerified"> & {
  /** BVN lookup with no selfie (Dojah GET /api/v1/kyc/bvn/full). */
  bvnLookup(bvn: string): Promise<DojahCall>;
  insertRecord(row: KycRecord, payload: Record<string, unknown>): Promise<"ok" | "duplicate">;
};

export type ModeOutcome = { ok: true; fullName: string | null } | Extract<VerifyOutcome, { ok: false }>;

const refused = (out: VerifyOutcome) => out as Extract<VerifyOutcome, { ok: false }>;

/** BVN lookup only: who the person is, with no selfie. Same caps and one-BVN-per-account rule as the full check. */
export async function verifyBvnOnly(body: Record<string, unknown>, deps: ModeDeps): Promise<ModeOutcome> {
  const bvn = typeof body.bvn === "string" ? body.bvn.replace(/\D/g, "") : "";
  if (bvn.length !== 11) return refused(fail("bvn_invalid"));

  // Charged before the duplicate check: otherwise the 409 would be a free BVN lookup.
  if (!(await deps.consumeAttempt())) return refused(fail("attempt_limit"));
  const bvnHmac = await deps.hmac(bvn);
  if (await deps.bvnLinkedElsewhere(bvnHmac)) return refused(fail("bvn_linked"));
  if (!(await deps.consumeDojahBudget())) {
    await deps.releaseAttempt();
    return refused(fail("attempt_limit"));
  }

  const found = await deps.bvnLookup(bvn);
  if (found.kind === "unavailable") {
    await deps.releaseAttempt();
    return refused(fail("unavailable"));
  }
  if (found.kind === "rejected") return refused(fail("bvn_failed"));

  const id = parseDojahIdentityEntity(found.json);
  if (!id.firstName || !id.lastName) return refused(fail("bvn_incomplete"));
  const dob = isoDateOrNull(id.dateOfBirth);
  const res = await deps.insertRecord(
    {
      method: "bvn",
      level: 2,
      bvn_hmac: bvnHmac,
      bvn_last_four: bvn.slice(-4),
      bvn_first_name: id.firstName,
      bvn_middle_name: id.middleName || null,
      bvn_last_name: id.lastName,
      bvn_dob: dob,
      liveness_score: null,
      selfie_match_confidence: null,
    },
    { source: "bvn", bvn: { first_name: id.firstName, middle_name: id.middleName || null, last_name: id.lastName, date_of_birth: dob } },
  );
  if (res === "duplicate") return refused(fail("bvn_linked"));
  return { ok: true, fullName: id.fullName };
}

/** A live selfie with no BVN: it shows a real person is there, not who they are. */
export async function verifySelfieOnly(body: Record<string, unknown>, deps: ModeDeps): Promise<ModeOutcome> {
  const selfie = typeof body.selfie_image === "string" ? body.selfie_image : "";
  if (!isJpegBase64Within(selfie, SELFIE_MAX_BYTES)) return refused(fail("selfie_invalid"));

  if (!(await deps.consumeAttempt())) return refused(fail("attempt_limit"));
  const unavailable = async () => {
    await deps.releaseAttempt();
    return refused(fail("unavailable"));
  };
  if (!(await deps.consumeDojahBudget())) {
    await deps.releaseAttempt();
    return refused(fail("attempt_limit"));
  }

  const live = await deps.liveness(selfie);
  if (live.kind === "unavailable") return await unavailable();
  if (live.kind === "rejected") return refused(fail("liveness_failed"));
  const score = parseLiveness(live.json);
  if (score === null) return livenessSaysNo(live.json) ? refused(fail("liveness_failed")) : await unavailable();
  if (score < (await deps.livenessMinScore())) return refused(fail("liveness_failed", { liveness: score }));

  await deps.insertRecord(
    {
      method: "selfie",
      level: 1,
      bvn_hmac: null,
      bvn_last_four: null,
      bvn_first_name: null,
      bvn_middle_name: null,
      bvn_last_name: null,
      bvn_dob: null,
      liveness_score: score,
      selfie_match_confidence: null,
    },
    { source: "selfie", liveness: { score } },
  );
  return { ok: true, fullName: null };
}

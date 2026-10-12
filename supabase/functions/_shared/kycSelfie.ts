// Level-2 BVN + selfie check (spec 2026-10-12-kyc-bvn-selfie-design §2). Pure: kyc-dojah-verify wires deps.
import { type DojahCall, parseDojahIdentityEntity } from "./dojahClient.ts";

export const SELFIE_MAX_BYTES = 1_500_000;
export const FACE_MATCH_MIN = 90;

export const KYC_ERRORS = {
  update_app: [400, "Update the app to verify with a selfie."],
  bvn_invalid: [400, "BVN must be 11 digits"],
  selfie_invalid: [400, "Selfie must be a JPEG photo under 1.5 MB."],
  attempt_limit: [429, "Maximum 5 verification attempts per 24 hours. Try again later."],
  bvn_linked: [409, "This BVN is already linked to another Doings account. Contact support."],
  liveness_failed: [422, "We couldn't confirm a live selfie. Retake it in good light, facing the camera."],
  face_mismatch: [422, "Your selfie doesn't match the photo on your BVN."],
  bvn_failed: [400, "BVN verification failed. Check the number and try again."],
  bvn_incomplete: [400, "BVN verification returned incomplete name data"],
  unavailable: [503, "Identity verification is temporarily unavailable. Please try again later."],
} as const;
export type KycErrorCode = keyof typeof KYC_ERRORS;

export type VerifiedInsert = {
  bvn_hmac: string;
  bvn_last_four: string;
  bvn_first_name: string;
  bvn_middle_name: string | null;
  bvn_last_name: string;
  bvn_dob: string | null;
  liveness_score: number;
  selfie_match_confidence: number;
};

export type VerifyDeps = {
  hmac(bvn: string): Promise<string>;
  consumeAttempt(): Promise<boolean>;
  releaseAttempt(): Promise<void>;
  bvnLinkedElsewhere(bvnHmac: string): Promise<boolean>;
  livenessMinScore(): Promise<number>;
  liveness(image: string): Promise<DojahCall>;
  bvnSelfie(bvn: string, image: string): Promise<DojahCall>;
  insertVerified(row: VerifiedInsert, payload: Record<string, unknown>): Promise<"ok" | "duplicate">;
};

export type VerifyOutcome =
  | { ok: true; fullName: string }
  | { ok: false; status: number; code: KycErrorCode; error: string };

function fail(code: KycErrorCode): VerifyOutcome {
  const [status, error] = KYC_ERRORS[code];
  return { ok: false, status, code, error };
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function entityOf(json: unknown): Record<string, unknown> {
  const root = obj(json);
  return obj(root.entity ?? root.data ?? root);
}

/** Plain base64 of a JPEG (FF D8 FF → "/9j/") no larger than maxBytes once decoded. */
export function isJpegBase64Within(b64: string, maxBytes: number): boolean {
  if (!b64.startsWith("/9j/") || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return false;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length * 3) / 4 - pad <= maxBytes;
}

/** Dojah liveness probability on a 0–100 scale (it may send 0–1). null when absent. */
export function parseLiveness(json: unknown): number | null {
  const entity = entityOf(json);
  const l = obj(entity.liveness ?? entity);
  const p = l.liveness_probability ?? l.probability ?? l.score;
  if (typeof p !== "number" || !Number.isFinite(p)) return null;
  return Math.round((p <= 1 ? p * 100 : p) * 100) / 100;
}

export function parseSelfieMatch(json: unknown): number | null {
  const v = obj(entityOf(json).selfie_verification).confidence_value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isoDateOrNull(s: string | null): string | null {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function mentionsFace(json: unknown): boolean {
  const root = obj(json);
  const text = [root.error, root.message].filter((x) => typeof x === "string").join(" ");
  return /face|selfie|image/i.test(text);
}

export async function verifyBvnSelfie(body: Record<string, unknown>, deps: VerifyDeps): Promise<VerifyOutcome> {
  const bvn = typeof body.bvn === "string" ? body.bvn.replace(/\D/g, "") : "";
  const selfie = typeof body.selfie_image === "string" ? body.selfie_image : "";

  if (!selfie && body.nin !== undefined) return fail("update_app");
  if (bvn.length !== 11) return fail("bvn_invalid");
  if (!isJpegBase64Within(selfie, SELFIE_MAX_BYTES)) return fail("selfie_invalid");

  // Charged before the duplicate check: otherwise the 409 would be a free BVN lookup.
  if (!(await deps.consumeAttempt())) return fail("attempt_limit");

  const bvnHmac = await deps.hmac(bvn);
  if (await deps.bvnLinkedElsewhere(bvnHmac)) return fail("bvn_linked");

  const unavailable = async () => {
    await deps.releaseAttempt();
    return fail("unavailable");
  };

  const live = await deps.liveness(selfie);
  if (live.kind === "unavailable") return await unavailable();
  if (live.kind === "rejected") return fail("liveness_failed");
  const livenessScore = parseLiveness(live.json);
  if (livenessScore === null) return await unavailable(); // format change on Dojah's side, not the user's fault
  if (livenessScore < (await deps.livenessMinScore())) return fail("liveness_failed");

  const match = await deps.bvnSelfie(bvn, selfie);
  if (match.kind === "unavailable") return await unavailable();
  if (match.kind === "rejected") return fail(mentionsFace(match.json) ? "face_mismatch" : "bvn_failed");

  const id = parseDojahIdentityEntity(match.json);
  if (!id.firstName || !id.lastName) return fail("bvn_incomplete");
  const confidence = parseSelfieMatch(match.json);
  if (confidence === null || confidence < FACE_MATCH_MIN) return fail("face_mismatch");

  const dob = isoDateOrNull(id.dateOfBirth);
  const payload = {
    source: "bvn_selfie",
    bvn: { first_name: id.firstName, middle_name: id.middleName || null, last_name: id.lastName, date_of_birth: dob },
    liveness: { score: livenessScore },
    selfie: { confidence, match: obj(entityOf(match.json).selfie_verification).match ?? null },
  };
  const res = await deps.insertVerified(
    {
      bvn_hmac: bvnHmac,
      bvn_last_four: bvn.slice(-4),
      bvn_first_name: id.firstName,
      bvn_middle_name: id.middleName || null,
      bvn_last_name: id.lastName,
      bvn_dob: dob,
      liveness_score: livenessScore,
      selfie_match_confidence: confidence,
    },
    payload,
  );
  if (res === "duplicate") return fail("bvn_linked");
  return { ok: true, fullName: id.fullName };
}

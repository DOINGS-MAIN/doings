import { assertEquals } from "jsr:@std/assert";
import type { DojahCall } from "./dojahClient.ts";
import { kycPlan, type KycRecord, type ModeDeps, type SellIdentity, verifyBvnOnly, verifySelfieOnly } from "./kycModes.ts";

const BVN = "22222222222";
const SELFIE = "/9j/" + "A".repeat(400);
const LIVE_OK: DojahCall = { kind: "ok", json: { entity: { liveness: { liveness_check: true, liveness_probability: 0.93 } } } };
const LOOKUP_OK: DojahCall = {
  kind: "ok",
  json: { entity: { bvn: BVN, first_name: "John", middle_name: "Ade", last_name: "Doe", date_of_birth: "28-Jun-2000", image: "/9j/PHOTO", phone_number1: "0803" } },
};

const st = (o: Partial<SellIdentity>): SellIdentity => ({ needs_bvn: true, needs_selfie: true, has_bvn: false, has_selfie: false, ...o });

Deno.test("the plan is the checks that are switched on and still missing", () => {
  assertEquals(kycPlan(st({})), "bvn_selfie");
  assertEquals(kycPlan(st({ needs_selfie: false })), "bvn");
  assertEquals(kycPlan(st({ needs_bvn: false })), "selfie");
  assertEquals(kycPlan(st({ needs_bvn: false, needs_selfie: false })), "none");
  assertEquals(kycPlan(st({ has_bvn: true, has_selfie: true })), "none");
  assertEquals(kycPlan(st({ needs_selfie: false, has_bvn: true })), "none");
  assertEquals(kycPlan(st({ needs_bvn: false, has_selfie: true })), "none");
});

Deno.test("a selfie added to a BVN is matched to that BVN, so the BVN is asked for again", () => {
  // BVN on file, selfie now required: only a face match against the BVN photo ties the two together.
  assertEquals(kycPlan(st({ has_bvn: true })), "bvn_selfie");
  // selfie on file, BVN now required: same, the pair is checked together.
  assertEquals(kycPlan(st({ has_selfie: true })), "bvn_selfie");
});

function deps(over: Partial<ModeDeps> = {}) {
  const calls: string[] = [];
  const inserted: { row: KycRecord; payload: Record<string, unknown> }[] = [];
  const d: ModeDeps = {
    hmac: async (v) => `h:${v.length}`,
    consumeAttempt: async () => (calls.push("consume"), true),
    releaseAttempt: async () => void calls.push("release"),
    bvnLinkedElsewhere: async () => (calls.push("dup"), false),
    consumeDojahBudget: async () => true,
    livenessMinScore: async () => 80,
    liveness: async () => (calls.push("liveness"), LIVE_OK),
    bvnLookup: async () => (calls.push("lookup"), LOOKUP_OK),
    insertRecord: async (row, payload) => (inserted.push({ row, payload }), calls.push("insert"), "ok"),
    ...over,
  };
  return { d, calls, inserted };
}
const codeOf = (out: unknown) => (out as { code?: string }).code;

Deno.test("BVN only: names and date of birth are stored, with no selfie, photo, phone or number", async () => {
  const { d, calls, inserted } = deps();
  const out = await verifyBvnOnly({ bvn: "222 222 222 22" }, d);
  assertEquals(out, { ok: true, fullName: "John Ade Doe" });
  assertEquals(calls, ["consume", "dup", "lookup", "insert"]);
  assertEquals(inserted[0].row, {
    method: "bvn", level: 2, bvn_hmac: "h:11", bvn_last_four: "2222", bvn_first_name: "John", bvn_middle_name: "Ade",
    bvn_last_name: "Doe", bvn_dob: "2000-06-28", liveness_score: null, selfie_match_confidence: null,
  });
  const text = JSON.stringify(inserted[0]);
  assertEquals(text.includes(BVN), false);
  assertEquals(text.includes("/9j/"), false);
  assertEquals(text.includes("0803"), false);
});

Deno.test("BVN only: a bad number costs nothing; a linked BVN is refused before Dojah is called", async () => {
  const a = deps();
  assertEquals(codeOf(await verifyBvnOnly({ bvn: "123" }, a.d)), "bvn_invalid");
  assertEquals(a.calls, []);
  const b = deps({ bvnLinkedElsewhere: async () => true });
  assertEquals(codeOf(await verifyBvnOnly({ bvn: BVN }, b.d)), "bvn_linked");
  assertEquals(b.calls, ["consume"]);
});

Deno.test("BVN only: the attempt cap and the Dojah budget both stop it", async () => {
  const a = deps({ consumeAttempt: async () => false });
  assertEquals(codeOf(await verifyBvnOnly({ bvn: BVN }, a.d)), "attempt_limit");
  const b = deps({ consumeDojahBudget: async () => false });
  assertEquals(codeOf(await verifyBvnOnly({ bvn: BVN }, b.d)), "attempt_limit");
  assertEquals(b.calls, ["consume", "dup", "release"]);
});

Deno.test("BVN only: Dojah down → 503 and the attempt is released; a wrong BVN → counted", async () => {
  const a = deps({ bvnLookup: async () => ({ kind: "unavailable" }) });
  assertEquals(codeOf(await verifyBvnOnly({ bvn: BVN }, a.d)), "unavailable");
  assertEquals(a.calls, ["consume", "dup", "release"]);
  const b = deps({ bvnLookup: async () => ({ kind: "rejected", status: 400, json: { error: "BVN not found" } }) });
  assertEquals(codeOf(await verifyBvnOnly({ bvn: BVN }, b.d)), "bvn_failed");
  assertEquals(b.calls, ["consume", "dup"]);
  const c = deps({ bvnLookup: async () => ({ kind: "ok", json: { entity: { first_name: "John" } } }) });
  assertEquals(codeOf(await verifyBvnOnly({ bvn: BVN }, c.d)), "bvn_incomplete");
});

Deno.test("BVN only: losing the unique-index race → 409", async () => {
  const { d } = deps({ insertRecord: async () => "duplicate" });
  assertEquals(codeOf(await verifyBvnOnly({ bvn: BVN }, d)), "bvn_linked");
});

Deno.test("selfie only: a live selfie is recorded at level 1 with its score and nothing else", async () => {
  const { d, calls, inserted } = deps();
  const out = await verifySelfieOnly({ selfie_image: SELFIE }, d);
  assertEquals(out, { ok: true, fullName: null });
  assertEquals(calls, ["consume", "liveness", "insert"]);
  assertEquals(inserted[0].row, {
    method: "selfie", level: 1, bvn_hmac: null, bvn_last_four: null, bvn_first_name: null, bvn_middle_name: null,
    bvn_last_name: null, bvn_dob: null, liveness_score: 93, selfie_match_confidence: null,
  });
  assertEquals(JSON.stringify(inserted[0]).includes("/9j/"), false);
});

Deno.test("selfie only: not a JPEG → nothing charged; not live → 422 and counted; Dojah down → released", async () => {
  const a = deps();
  assertEquals(codeOf(await verifySelfieOnly({ selfie_image: "hello" }, a.d)), "selfie_invalid");
  assertEquals(a.calls, []);
  const b = deps({ liveness: async () => ({ kind: "ok", json: { entity: { liveness: { liveness_probability: 0.2 } } } }) });
  assertEquals(codeOf(await verifySelfieOnly({ selfie_image: SELFIE }, b.d)), "liveness_failed");
  assertEquals(b.calls, ["consume"]);
  const c = deps({ liveness: async () => ({ kind: "unavailable" }) });
  assertEquals(codeOf(await verifySelfieOnly({ selfie_image: SELFIE }, c.d)), "unavailable");
  assertEquals(c.calls, ["consume", "release"]);
  const e = deps({ liveness: async () => ({ kind: "rejected", status: 400, json: {} }) });
  assertEquals(codeOf(await verifySelfieOnly({ selfie_image: SELFIE }, e.d)), "liveness_failed");
});

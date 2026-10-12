import { assertEquals } from "jsr:@std/assert";
import type { DojahCall } from "./dojahClient.ts";
import { verifyBvnSelfie, type VerifiedInsert, type VerifyDeps } from "./kycSelfie.ts";

const BVN = "22222222222";
const SELFIE = "/9j/" + "A".repeat(400); // JPEG magic (FF D8 FF) in base64

const LIVE_OK: DojahCall = { kind: "ok", json: { entity: { liveness: { liveness_check: true, liveness_probability: 0.93 } } } };
const MATCH_OK: DojahCall = {
  kind: "ok",
  json: {
    entity: {
      bvn: BVN, first_name: "John", middle_name: "Ade", last_name: "Doe", date_of_birth: "1990-01-31",
      image: "/9j/BVNPHOTO", selfie_verification: { confidence_value: 97.5, match: true },
    },
  },
};

function deps(over: Partial<VerifyDeps> = {}) {
  const calls: string[] = [];
  const inserted: { row: VerifiedInsert; payload: Record<string, unknown> }[] = [];
  const d: VerifyDeps = {
    hmac: async (v) => `h:${v}`,
    consumeAttempt: async () => (calls.push("consume"), true),
    releaseAttempt: async () => void calls.push("release"),
    bvnLinkedElsewhere: async () => (calls.push("dup"), false),
    livenessMinScore: async () => 80,
    liveness: async () => (calls.push("liveness"), LIVE_OK),
    bvnSelfie: async () => (calls.push("match"), MATCH_OK),
    insertVerified: async (row, payload) => (inserted.push({ row, payload }), calls.push("insert"), "ok"),
    ...over,
  };
  return { d, calls, inserted };
}

const body = (o: Record<string, unknown> = {}) => ({ bvn: BVN, selfie_image: SELFIE, ...o });
const codeOf = (out: unknown) => (out as { code?: string }).code;

Deno.test("old-app NIN request is told to update, with no attempt or Dojah call", async () => {
  const { d, calls } = deps();
  const out = await verifyBvnSelfie({ bvn: BVN, nin: "12345678901" }, d);
  assertEquals(out, { ok: false, status: 400, code: "update_app", error: "Update the app to verify with a selfie." });
  assertEquals(calls, []);
});

Deno.test("validation happens before any attempt is charged", async () => {
  const { d, calls } = deps();
  assertEquals(codeOf(await verifyBvnSelfie(body({ bvn: "123" }), d)), "bvn_invalid");
  assertEquals(codeOf(await verifyBvnSelfie(body({ selfie_image: "data:image/jpeg;base64,/9j/AAAA" }), d)), "selfie_invalid");
  assertEquals(codeOf(await verifyBvnSelfie(body({ selfie_image: "iVBORw0KGgo=" }), d)), "selfie_invalid"); // PNG
  assertEquals(codeOf(await verifyBvnSelfie(body({ selfie_image: "/9j/" + "A".repeat(2_000_000) }), d)), "selfie_invalid");
  assertEquals(calls, []);
});

Deno.test("the cap runs before the duplicate check, so 409 can't be used to look up BVNs", async () => {
  const { d, calls } = deps({ consumeAttempt: async () => false, bvnLinkedElsewhere: async () => true });
  const out = await verifyBvnSelfie(body(), d);
  assertEquals(codeOf(out), "attempt_limit");
  assertEquals((out as { status: number }).status, 429);
  assertEquals(calls, []);
});

Deno.test("a BVN linked to another account is refused before any Dojah call", async () => {
  const { d, calls } = deps({ bvnLinkedElsewhere: async () => true });
  const out = await verifyBvnSelfie(body(), d);
  assertEquals(out, {
    ok: false, status: 409, code: "bvn_linked",
    error: "This BVN is already linked to another Doings account. Contact support.",
  });
  assertEquals(calls, ["consume"]);
});

Deno.test("low liveness → 422, attempt counted, no match call", async () => {
  const low: DojahCall = { kind: "ok", json: { entity: { liveness: { liveness_probability: 0.2 } } } };
  const { d, calls } = deps({ liveness: async () => (calls.push("liveness"), low) });
  assertEquals(codeOf(await verifyBvnSelfie(body(), d)), "liveness_failed");
  assertEquals(calls, ["consume", "dup", "liveness"]);
});

Deno.test("liveness 4xx (no face) → 422 and counted; unparseable 200 → 503 and released", async () => {
  const a = deps({ liveness: async () => ({ kind: "rejected", status: 400, json: { error: "Face not detected" } }) });
  assertEquals(codeOf(await verifyBvnSelfie(body(), a.d)), "liveness_failed");
  assertEquals(a.calls.includes("release"), false);
  const b = deps({ liveness: async () => ({ kind: "ok", json: { entity: {} } }) });
  assertEquals(codeOf(await verifyBvnSelfie(body(), b.d)), "unavailable");
  assertEquals(b.calls.at(-1), "release");
});

Deno.test("Dojah unavailable at either step → 503 and the attempt is released", async () => {
  const a = deps({ liveness: async () => ({ kind: "unavailable" }) });
  const outA = await verifyBvnSelfie(body(), a.d);
  assertEquals((outA as { status: number }).status, 503);
  assertEquals(a.calls, ["consume", "dup", "release"]);
  const b = deps({ bvnSelfie: async () => ({ kind: "unavailable" }) });
  assertEquals(codeOf(await verifyBvnSelfie(body(), b.d)), "unavailable");
  assertEquals(b.calls.at(-1), "release");
});

Deno.test("face match below 90 → 422; BVN 4xx → bvn_failed; face-related 4xx → face_mismatch", async () => {
  const low: DojahCall = { kind: "ok", json: { entity: { first_name: "J", last_name: "D", selfie_verification: { confidence_value: 89.9 } } } };
  assertEquals(codeOf(await verifyBvnSelfie(body(), deps({ bvnSelfie: async () => low }).d)), "face_mismatch");
  const notFound: DojahCall = { kind: "rejected", status: 404, json: { error: "BVN not found" } };
  assertEquals(codeOf(await verifyBvnSelfie(body(), deps({ bvnSelfie: async () => notFound }).d)), "bvn_failed");
  const noFace: DojahCall = { kind: "rejected", status: 400, json: { error: "No face detected in selfie image" } };
  assertEquals(codeOf(await verifyBvnSelfie(body(), deps({ bvnSelfie: async () => noFace }).d)), "face_mismatch");
});

Deno.test("success inserts names, DOB, both scores and a trimmed payload, with no images or numbers", async () => {
  const { d, inserted } = deps();
  const out = await verifyBvnSelfie(body({ bvn: "222-2222-2222" }), d);
  assertEquals(out, { ok: true, fullName: "John Ade Doe" });
  assertEquals(inserted[0].row, {
    bvn_hmac: `h:${BVN}`, bvn_last_four: "2222",
    bvn_first_name: "John", bvn_middle_name: "Ade", bvn_last_name: "Doe", bvn_dob: "1990-01-31",
    liveness_score: 93, selfie_match_confidence: 97.5,
  });
  const text = JSON.stringify(inserted[0].payload);
  assertEquals(/\d{11}/.test(text) || text.includes("/9j/"), false);
  assertEquals(inserted[0].payload.source, "bvn_selfie");
});

Deno.test("a DOB Dojah sends in another format is stored as null, not a failed insert", async () => {
  const odd: DojahCall = { kind: "ok", json: { entity: { first_name: "A", last_name: "B", date_of_birth: "31-Jan-1990", selfie_verification: { confidence_value: 95 } } } };
  const { d, inserted } = deps({ bvnSelfie: async () => odd });
  await verifyBvnSelfie(body(), d);
  assertEquals(inserted[0].row.bvn_dob, null);
});

Deno.test("losing the unique-index race → 409, not 500", async () => {
  const { d } = deps({ insertVerified: async () => "duplicate" });
  assertEquals(codeOf(await verifyBvnSelfie(body(), d)), "bvn_linked");
});

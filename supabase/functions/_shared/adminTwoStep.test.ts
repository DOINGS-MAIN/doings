import { assertEquals } from "jsr:@std/assert";
import { tokenAal, twoStepRefusal } from "./adminTwoStep.ts";

const b64url = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const token = (claims: unknown) => `${b64url({ alg: "HS256" })}.${b64url(claims)}.signature`;

Deno.test("tokenAal: reads the assurance level from the session token", () => {
  assertEquals(tokenAal(`Bearer ${token({ sub: "u", aal: "aal2" })}`), "aal2");
  assertEquals(tokenAal(`Bearer ${token({ sub: "u", aal: "aal1" })}`), "aal1");
  assertEquals(tokenAal(token({ sub: "u", aal: "aal2" })), "aal2");
});

Deno.test("tokenAal: anything unclear counts as password only", () => {
  assertEquals(tokenAal(`Bearer ${token({ sub: "u" })}`), "aal1");
  assertEquals(tokenAal(`Bearer ${token({ sub: "u", aal: "aal3" })}`), "aal1");
  assertEquals(tokenAal(`Bearer ${token({ sub: "u", aal: 2 })}`), "aal1");
  assertEquals(tokenAal("Bearer not-a-token"), "aal1");
  assertEquals(tokenAal("Bearer a.%%%.c"), "aal1");
  assertEquals(tokenAal(""), "aal1");
  assertEquals(tokenAal(null), "aal1");
});

Deno.test("tokenAal: claims with characters outside ASCII still decode", () => {
  assertEquals(tokenAal(`Bearer ${b64url({ alg: "x" })}.${btoa(unescape(encodeURIComponent(JSON.stringify({ name: "Adé", aal: "aal2" })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`), "aal2");
});

const base = { role: "super_admin", required: true, aal: "aal1" as const, resource: "users", action: undefined as string | undefined };

Deno.test("twoStepRefusal: a super admin without the code is refused once the rule is on", () => {
  assertEquals(twoStepRefusal(base), "Enter your two-step code to continue");
  assertEquals(twoStepRefusal({ ...base, resource: "team", action: "invite" }), "Enter your two-step code to continue");
});

Deno.test("twoStepRefusal: with the code, or with the rule off, nothing is refused", () => {
  assertEquals(twoStepRefusal({ ...base, aal: "aal2" }), null);
  assertEquals(twoStepRefusal({ ...base, required: false }), null);
});

Deno.test("twoStepRefusal: other roles are not held to it", () => {
  for (const role of ["finance", "support", "compliance", "moderation", ""]) {
    assertEquals(twoStepRefusal({ ...base, role }), null);
  }
});

Deno.test("twoStepRefusal: recording the sign-in is allowed before the code (it is how sign-in starts)", () => {
  assertEquals(twoStepRefusal({ ...base, resource: "team", action: "accept" }), null);
  assertEquals(twoStepRefusal({ ...base, resource: "users", action: "accept" }), "Enter your two-step code to continue");
});

Deno.test("twoStepRefusal: signing out is recorded even before the code is entered", () => {
  assertEquals(twoStepRefusal({ ...base, resource: "team", action: "sign-out" }), null);
  assertEquals(twoStepRefusal({ ...base, resource: "users", action: "sign-out" }), "Enter your two-step code to continue");
});

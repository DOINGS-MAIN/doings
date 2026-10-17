import { assertEquals } from "jsr:@std/assert";
import { can, escapeLikePattern, payoutCheckRefusal, payoutConfirmMatches, permissionFor, ROLE_PERMISSIONS, teamChangeAllowed } from "./adminAccess.ts";

const ROLES = ["super_admin", "finance", "support", "compliance", "moderation"] as const;

// [resource, method, action, hasId, permission, roles allowed (besides super_admin)]
const ROUTES: [string, string, string | undefined, boolean, string, string[]][] = [
  ["stats", "GET", undefined, false, "dashboard", ["finance", "support", "compliance", "moderation"]],
  ["users", "GET", undefined, false, "users.view", ["support", "compliance", "moderation"]],
  ["users", "GET", undefined, true, "users.view", ["support", "compliance", "moderation"]],
  ["users", "POST", "suspend", true, "users.suspend", ["compliance"]],
  ["users", "POST", "unsuspend", true, "users.suspend", ["compliance"]],
  ["users", "POST", "ban", true, "users.suspend", ["compliance"]],
  ["users", "POST", "unban", true, "users.suspend", ["compliance"]],
  ["transactions", "GET", undefined, false, "transactions.view", ["finance", "support"]],
  ["transactions", "GET", undefined, true, "transactions.view", ["finance", "support"]],
  ["transactions", "POST", "flag", true, "transactions.write", ["finance"]],
  ["transactions", "POST", "unflag", true, "transactions.write", ["finance"]],
  ["transactions", "POST", "refund", true, "transactions.write", ["finance"]],
  ["kyc", "GET", undefined, false, "kyc", ["compliance"]],
  ["events", "GET", undefined, false, "events.view", ["support", "moderation"]],
  ["events", "POST", "flag", true, "events.flag", ["moderation"]],
  ["events", "POST", "unflag", true, "events.flag", ["moderation"]],
  ["events", "POST", "end", true, "events.end", ["support", "moderation"]],
  ["team", "GET", undefined, false, "*", []],
  ["team", "POST", "invite", false, "*", []],
  ["team", "POST", "disable", true, "*", []],
  ["team", "POST", "enable", true, "*", []],
  ["team", "POST", "role", true, "*", []],
  ["audit", "GET", undefined, false, "*", []],
  ["payment-rails", "GET", undefined, false, "payment_rails", ["finance"]],
  ["payment-rails", "GET", "health", true, "payment_rails", ["finance"]],
  ["payment-rails", "POST", "probe-all", false, "payment_rails", ["finance"]],
  ["payments", "GET", undefined, false, "payments", ["finance", "support"]],
  ["webhooks", "GET", undefined, false, "webhooks.view", ["finance", "support"]],
  ["webhooks", "GET", undefined, true, "webhooks.view", ["finance", "support"]],
  ["webhooks", "POST", "reprocess", true, "webhooks.write", ["finance"]],
  ["queue", "GET", undefined, false, "queue", ["finance", "support"]],
  ["psp-events", "GET", undefined, false, "psp_events", ["finance", "support"]],
];

Deno.test("permissionFor maps every admin route", () => {
  for (const [res, method, action, hasId, perm] of ROUTES) {
    assertEquals(permissionFor(res, method, action, hasId), perm, `${method} ${res} ${action ?? ""}`);
  }
});

Deno.test("every role is allowed or refused on every route", () => {
  for (const [res, method, action, hasId, , allowed] of ROUTES) {
    const perm = permissionFor(res, method, action, hasId)!;
    for (const role of ROLES) {
      const expected = role === "super_admin" || allowed.includes(role);
      assertEquals(can(role, perm), expected, `${role} → ${method} ${res} ${action ?? ""}`);
    }
  }
});

Deno.test("unknown routes, removed KYC actions and wrong methods have no permission", () => {
  assertEquals(permissionFor("unknown", "GET"), null);
  assertEquals(permissionFor("nope", "GET"), null);
  assertEquals(permissionFor("kyc", "POST", "approve", true), null);
  assertEquals(permissionFor("kyc", "POST", "reject", true), null);
  assertEquals(permissionFor("users", "POST", "delete", true), null);
  assertEquals(permissionFor("users", "DELETE", undefined, true), null);
  assertEquals(permissionFor("transactions", "POST", "wipe", true), null);
  assertEquals(permissionFor("stats", "POST"), null);
  assertEquals(permissionFor("queue", "POST"), null);
});

Deno.test("can: super_admin has everything, unknown roles and permissions nothing", () => {
  assertEquals(can("super_admin", "anything.at.all"), true);
  assertEquals(can("nope", "dashboard"), false);
  assertEquals(can("", "dashboard"), false);
  assertEquals(can("finance", "*"), false);
  assertEquals(can("finance", "made_up"), false);
  assertEquals(can("support", "floor_avatars"), true);
  assertEquals(can("moderation", "ads"), true);
  assertEquals(can("finance", "dance_floor"), true);
  assertEquals(can("toString", "dashboard"), false);
});

Deno.test("ROLE_PERMISSIONS matches the agreed matrix", () => {
  assertEquals(ROLE_PERMISSIONS.super_admin, ["*"]);
  assertEquals([...ROLE_PERMISSIONS.compliance].sort(), ["dashboard", "kyc", "users.suspend", "users.view"]);
  assertEquals([...ROLE_PERMISSIONS.support].sort(), [
    "dashboard", "events.end", "events.view", "floor_avatars", "payments", "psp_events", "queue", "transactions.view", "users.view", "webhooks.view",
  ]);
});

const ME = "auth-me";
const base = { actorAuthId: ME, targetUserId: "auth-other", targetRole: "finance", activeSuperAdmins: 2 };

Deno.test("teamChangeAllowed refuses self-disable and self-demote", () => {
  assertEquals(typeof teamChangeAllowed({ ...base, targetUserId: ME, targetRole: "super_admin", disable: true }), "string");
  assertEquals(typeof teamChangeAllowed({ ...base, targetUserId: ME, targetRole: "super_admin", newRole: "finance" }), "string");
});

Deno.test("teamChangeAllowed refuses removing the last active super admin", () => {
  const last = { ...base, targetRole: "super_admin", activeSuperAdmins: 1 };
  assertEquals(typeof teamChangeAllowed({ ...last, disable: true }), "string");
  assertEquals(typeof teamChangeAllowed({ ...last, newRole: "support" }), "string");
});

Deno.test("teamChangeAllowed allows normal changes", () => {
  assertEquals(teamChangeAllowed({ ...base, disable: true }), null);
  assertEquals(teamChangeAllowed({ ...base, newRole: "support" }), null);
  assertEquals(teamChangeAllowed({ ...base, targetRole: "super_admin", disable: true }), null);
  assertEquals(teamChangeAllowed({ ...base, targetRole: "super_admin", newRole: "finance" }), null);
  assertEquals(teamChangeAllowed({ ...base, targetUserId: ME, targetRole: "super_admin", newRole: "super_admin" }), null);
  assertEquals(teamChangeAllowed({ ...base, disable: false }), null);
});

Deno.test("teamChangeAllowed refuses unknown roles", () => {
  assertEquals(typeof teamChangeAllowed({ ...base, newRole: "god" }), "string");
});

Deno.test("escapeLikePattern makes an email match only itself in ilike", () => {
  assertEquals(escapeLikePattern("john_doe@x.com"), "john\\_doe@x.com");
  assertEquals(escapeLikePattern("100%@x.com"), "100\\%@x.com");
  assertEquals(escapeLikePattern("a\\b@x.com"), "a\\\\b@x.com");
  assertEquals(escapeLikePattern("plain@x.com"), "plain@x.com");
});

Deno.test("permissionFor: payouts and bundle orders", () => {
  assertEquals(permissionFor("payouts", "GET", undefined, false), "transactions.view");
  assertEquals(permissionFor("payouts", "GET", undefined, true), "transactions.view");
  assertEquals(permissionFor("payouts", "POST", "check", true), "transactions.write");
  assertEquals(permissionFor("payouts", "POST", "resolve", true), "transactions.write");
  assertEquals(permissionFor("payouts", "POST", "resolve", false), null);
  assertEquals(permissionFor("payouts", "POST", "delete", true), null);
  assertEquals(permissionFor("bundle-orders", "GET", undefined, false), "transactions.view");
  assertEquals(permissionFor("bundle-orders", "POST", "check", true), "transactions.write");
  assertEquals(permissionFor("bundle-orders", "POST", "refund", true), "transactions.write");
  assertEquals(permissionFor("bundle-orders", "POST", "resolve", true), null);
});

Deno.test("payouts: support views but can't act; compliance and moderation can't view", () => {
  assertEquals(can("support", permissionFor("payouts", "GET")!), true);
  assertEquals(can("support", permissionFor("payouts", "POST", "resolve", true)!), false);
  assertEquals(can("finance", permissionFor("payouts", "POST", "resolve", true)!), true);
  assertEquals(can("compliance", permissionFor("payouts", "GET")!), false);
  assertEquals(can("moderation", permissionFor("bundle-orders", "GET")!), false);
});

Deno.test("payoutConfirmMatches: exact reference, spaces trimmed, never empty", () => {
  assertEquals(payoutConfirmMatches("SELL-ab12-xyz", "SELL-ab12-xyz"), true);
  assertEquals(payoutConfirmMatches("  SELL-ab12-xyz ", "SELL-ab12-xyz"), true);
  assertEquals(payoutConfirmMatches("sell-ab12-xyz", "SELL-ab12-xyz"), false);
  assertEquals(payoutConfirmMatches("SELL-ab12", "SELL-ab12-xyz"), false);
  assertEquals(payoutConfirmMatches("", ""), false);
  assertEquals(payoutConfirmMatches(undefined, "SELL-1"), false);
  assertEquals(payoutConfirmMatches("x", null), false);
});

Deno.test("payoutCheckRefusal: only open NGN non-Blockradar withdrawals can be checked", () => {
  const ok = { type: "withdrawal", currency: "NGN", provider: "flutterwave", status: "processing" };
  assertEquals(payoutCheckRefusal(ok), null);
  assertEquals(payoutCheckRefusal({ ...ok, provider: null, status: "pending" }), null);
  assertEquals(payoutCheckRefusal({ ...ok, type: "deposit" })?.status, 404);
  assertEquals(payoutCheckRefusal({ ...ok, currency: "USDC" })?.status, 400);
  assertEquals(payoutCheckRefusal({ ...ok, provider: "blockradar" })?.status, 400);
  assertEquals(payoutCheckRefusal({ ...ok, status: "completed" }), { status: 409, error: "Payout is already completed" });
});

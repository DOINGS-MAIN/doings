import { assertEquals } from "jsr:@std/assert";
import { type AuditEntry, audited, clientIp, makeAudit, reasonDetails } from "./adminAudit.ts";

const h = (init: Record<string, string>) => new Headers(init);

Deno.test("the caller's address is the first one in x-forwarded-for", () => {
  assertEquals(clientIp(h({ "x-forwarded-for": "102.89.1.7, 10.0.0.1" })), "102.89.1.7");
  assertEquals(clientIp(h({ "x-forwarded-for": " 2001:db8::1 ,10.0.0.1" })), "2001:db8::1");
});

Deno.test("the address the edge network saw wins over a list the caller can write themselves", () => {
  assertEquals(clientIp(h({ "x-forwarded-for": "8.8.8.8, 102.89.1.8", "cf-connecting-ip": "102.89.1.8" })), "102.89.1.8");
  assertEquals(clientIp(h({ "x-forwarded-for": "8.8.8.8", "x-real-ip": "102.89.1.9" })), "102.89.1.9");
  assertEquals(clientIp(h({ "cf-connecting-ip": "not an address", "x-forwarded-for": "102.89.1.7" })), "102.89.1.7");
});

Deno.test("text that is not an address is never passed to the database", () => {
  assertEquals(clientIp(h({ "x-forwarded-for": "unknown" })), null);
  assertEquals(clientIp(h({ "x-forwarded-for": "1.2.3.4'; DROP TABLE x" })), null);
  assertEquals(clientIp(h({ "x-forwarded-for": "999.1.1.1" })), null);
  assertEquals(clientIp(h({ "x-forwarded-for": ":::::" })), null);
  assertEquals(clientIp(h({})), null);
});

Deno.test("an audit entry carries the admin, the action, the target and the caller's address", async () => {
  const calls: unknown[] = [];
  const audit = makeAudit((fn, args) => { calls.push([fn, args]); return Promise.resolve({ error: null }); }, "admin-1", "102.89.1.7");
  await audit({ action: "ban_user", targetType: "user", targetId: "u-1", details: { reason: "fraud" } });
  await audit({ action: "export_users", targetType: "user" });
  assertEquals(calls, [
    ["log_admin_action", { p_admin_id: "admin-1", p_action: "ban_user", p_target_type: "user", p_target_id: "u-1", p_details: { reason: "fraud" }, p_ip_address: "102.89.1.7" }],
    ["log_admin_action", { p_admin_id: "admin-1", p_action: "export_users", p_target_type: "user", p_target_id: null, p_details: null, p_ip_address: "102.89.1.7" }],
  ]);
});

Deno.test("a record that could not be written stops the request", async () => {
  const audit = makeAudit(() => Promise.resolve({ error: { message: "disk full" } }), "admin-1", null);
  let thrown: unknown = null;
  try { await audit({ action: "ban_user", targetType: "user", targetId: "u-1" }); } catch (e) { thrown = e; }
  assertEquals((thrown as { message?: string } | null)?.message, "disk full");
});

// ── audited: the record is written before the action ────────────────────────────────────────────
const ban: AuditEntry = { action: "ban_user", targetType: "user", targetId: "u-1", details: { reason: "fraud" } };
function recorder(failOn?: string) {
  const log: string[] = [];
  const entries: AuditEntry[] = [];
  const audit = (entry: AuditEntry) => {
    if (entry.action === failOn) return Promise.reject(new Error("log down"));
    log.push("record:" + entry.action);
    entries.push(entry);
    return Promise.resolve();
  };
  return { log, entries, audit };
}

Deno.test("the record is written before the action runs", async () => {
  const r = recorder();
  const value = await audited(r.audit, ban, () => { r.log.push("action"); return Promise.resolve("done"); });
  assertEquals(value, "done");
  assertEquals(r.log, ["record:ban_user", "action"]);
});

Deno.test("when the record cannot be written the action never runs", async () => {
  const r = recorder("ban_user");
  let thrown: unknown = null;
  try { await audited(r.audit, ban, () => { r.log.push("action"); return Promise.resolve("done"); }); } catch (e) { thrown = e; }
  assertEquals((thrown as Error).message, "log down");
  assertEquals(r.log, []);
});

Deno.test("an action that throws leaves a second record saying it failed, and the error still surfaces", async () => {
  const r = recorder();
  let thrown: unknown = null;
  try { await audited(r.audit, ban, () => Promise.reject(new Error("db timeout"))); } catch (e) { thrown = e; }
  assertEquals((thrown as Error).message, "db timeout");
  assertEquals(r.entries[1], { action: "ban_user_failed", targetType: "user", targetId: "u-1", details: { reason: "db timeout" } });
});

Deno.test("a refusal (an error response) is recorded as not done", async () => {
  const r = recorder();
  const res = await audited(r.audit, ban, () => Promise.resolve(new Response("{}", { status: 404 })));
  assertEquals(res.status, 404);
  assertEquals(r.entries[1], { action: "ban_user_failed", targetType: "user", targetId: "u-1", details: { reason: "refused with status 404" } });
});

Deno.test("a successful response leaves only the first record", async () => {
  const r = recorder();
  await audited(r.audit, ban, () => Promise.resolve(new Response("{}", { status: 200 })));
  assertEquals(r.log, ["record:ban_user"]);
});

Deno.test("what the action found is recorded afterwards when asked for", async () => {
  const r = recorder();
  await audited(r.audit, { action: "check_payout", targetType: "transaction", targetId: "t-1" },
    () => Promise.resolve({ status: "completed" }), { result: (v) => v });
  assertEquals(r.entries[1], { action: "check_payout_result", targetType: "transaction", targetId: "t-1", details: { status: "completed" } });
});

Deno.test("a caller can say what counts as not done", async () => {
  const r = recorder();
  await audited(r.audit, { action: "check_payout", targetType: "transaction", targetId: "t-1" },
    () => Promise.resolve({ error: "provider down", status: 502 }),
    { notDone: (v) => ("error" in v ? v.error : null), result: (v) => v });
  assertEquals(r.entries.map((e) => e.action), ["check_payout", "check_payout_failed"]);
  assertEquals(r.entries[1].details, { reason: "provider down" });
});

Deno.test("a follow-up record that cannot be written does not undo or hide the action's outcome", async () => {
  const r = recorder("check_payout_result");
  const value = await audited(r.audit, { action: "check_payout", targetType: "transaction", targetId: "t-1" },
    () => Promise.resolve({ status: "completed" }), { result: (v) => v });
  assertEquals(value, { status: "completed" });
});

Deno.test("an optional reason goes into the audit details only when one was given", () => {
  assertEquals(reasonDetails({ reason: "  checked with the host " }), { reason: "checked with the host" });
  assertEquals(reasonDetails({ reason: "   " }), undefined);
  assertEquals(reasonDetails({}), undefined);
  assertEquals(reasonDetails(null), undefined);
  assertEquals(reasonDetails({ reason: 42 }), undefined);
  assertEquals(reasonDetails({ reason: "x".repeat(600) })?.reason.length, 500);
});

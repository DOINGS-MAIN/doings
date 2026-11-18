import { assertEquals } from "jsr:@std/assert";
import { clientIp, makeAudit } from "./adminAudit.ts";

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

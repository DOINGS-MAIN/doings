import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS as UI_PERMISSIONS, can as uiCan } from "../types/admin";
import { ROLE_PERMISSIONS as SERVER_PERMISSIONS, can as serverCan } from "../../supabase/functions/_shared/adminAccess";

// The admin UI hides what the server refuses; both must use the same matrix.
describe("admin role matrix parity", () => {
  it("UI and server grant the same permissions to every role", () => {
    const sorted = (m: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(m).map(([role, perms]) => [role, [...perms].sort()]));
    expect(sorted(UI_PERMISSIONS)).toEqual(sorted(SERVER_PERMISSIONS));
  });

  it("UI and server agree on can() for every role and permission", () => {
    const perms = new Set(Object.values(SERVER_PERMISSIONS).flat().concat(["*", "made_up"]));
    for (const role of [...Object.keys(SERVER_PERMISSIONS), "nope"]) {
      for (const p of perms) expect(uiCan(role, p)).toBe(serverCan(role, p));
    }
  });
});

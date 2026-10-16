import { describe, expect, it } from "vitest";
import { cameFromEmailLink } from "./authMethods";

const token = (payload: unknown) =>
  `x.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.y`;

describe("cameFromEmailLink", () => {
  it("is true for sessions from a recovery or invite link", () => {
    expect(cameFromEmailLink(token({ amr: [{ method: "recovery", timestamp: 1 }] }))).toBe(true);
    expect(cameFromEmailLink(token({ amr: [{ method: "invite", timestamp: 1 }] }))).toBe(true);
  });

  it("is false for password sign-ins and bad tokens", () => {
    expect(cameFromEmailLink(token({ amr: [{ method: "password", timestamp: 1 }] }))).toBe(false);
    expect(cameFromEmailLink(token({}))).toBe(false);
    expect(cameFromEmailLink("not-a-jwt")).toBe(false);
    expect(cameFromEmailLink(undefined)).toBe(false);
  });
});

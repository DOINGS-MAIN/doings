import { describe, expect, it } from "vitest";
import { adAspectWarning, adImageError, adLinkError, adStatus, tapRate } from "./adsAdmin";

const NOW = Date.parse("2026-10-16T12:00:00Z");
describe("adStatus", () => {
  it("derives Paused, Scheduled, Ended and Live", () => {
    expect(adStatus({ is_active: false, starts_at: "2026-10-01T00:00:00Z", ends_at: null }, NOW)).toBe("Paused");
    expect(adStatus({ is_active: true, starts_at: "2026-10-17T00:00:00Z", ends_at: null }, NOW)).toBe("Scheduled");
    expect(adStatus({ is_active: true, starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-10-16T11:00:00Z" }, NOW)).toBe("Ended");
    expect(adStatus({ is_active: true, starts_at: "2026-10-01T00:00:00Z", ends_at: null }, NOW)).toBe("Live");
  });
});
describe("adLinkError", () => {
  it("matches the database rule", () => {
    for (const ok of ["", "/event/1", "/", "https://shop.example/x"]) expect(adLinkError(ok)).toBeNull();
    for (const bad of ["//evil.com", "/\\evil.com", "http://x.com", "javascript:alert(1)", "https://a b", "shop.example"]) {
      expect(adLinkError(bad)).not.toBeNull();
    }
  });
});
describe("images", () => {
  it("blocks wrong types and files over 1 MB", () => {
    expect(adImageError({ type: "image/jpeg", size: 1_048_576 })).toBeNull();
    expect(adImageError({ type: "image/gif", size: 10 })).not.toBeNull();
    expect(adImageError({ type: "image/png", size: 1_048_577 })).not.toBeNull();
  });
  it("warns when the shape is more than 15% off the banner", () => {
    expect(adAspectWarning(960, 319, "mobile")).toBeNull();
    expect(adAspectWarning(1000, 1000, "mobile")).not.toBeNull();
    expect(adAspectWarning(1083, 131, "desktop")).toBeNull();
    expect(adAspectWarning(960, 319, "desktop")).not.toBeNull();
  });
});
it("tapRate", () => {
  expect(tapRate(0, 0)).toBe("—");
  expect(tapRate(8, 1)).toBe("12.5%");
});

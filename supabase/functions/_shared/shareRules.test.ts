import { assertEquals } from "jsr:@std/assert";
import { shareAllowance, shareSettingsFromRead, shareSettingsFromRow, STRICT_SHARE_SETTINGS } from "./shareRules.ts";

const gifting = { requiresIdentity: false, l1Kobo: 20_000_000, l2Kobo: 500_000_000 };
const fintech = { ...gifting, requiresIdentity: true };

Deno.test("gifting mode: a verified email is enough to share, at the email-only limit", () => {
  assertEquals(shareAllowance("NGN", 1, gifting), { dailyLimit: 20_000_000 });
  assertEquals(shareAllowance("NGN", 2, gifting), { dailyLimit: 500_000_000 });
});

Deno.test("with the switch on, sharing needs BVN and selfie again", () => {
  assertEquals(shareAllowance("NGN", 1, fintech), {
    error: "Complete identity verification (BVN + selfie) to send money", code: "IDENTITY_REQUIRED",
  });
  assertEquals(shareAllowance("NGN", 2, fintech), { dailyLimit: 500_000_000 });
});

Deno.test("an unverified email can never share", () => {
  assertEquals(shareAllowance("NGN", 0, gifting), { error: "Verify your email to share bundles", code: "EMAIL_REQUIRED" });
  assertEquals(shareAllowance("NGN", 0, fintech), { error: "Verify your email to share bundles", code: "EMAIL_REQUIRED" });
});

Deno.test("a limit of 0 switches sharing off for that level", () => {
  assertEquals(shareAllowance("NGN", 1, { ...gifting, l1Kobo: 0 }), {
    error: "Sharing is not available on your account right now", code: "SHARING_OFF",
  });
});

Deno.test("USDC is not part of gifting: it keeps the BVN rule and its own limit", () => {
  assertEquals(shareAllowance("USDC", 1, gifting), {
    error: "Complete identity verification (BVN + selfie) to send money", code: "IDENTITY_REQUIRED",
  });
  assertEquals(shareAllowance("USDC", 2, gifting), { dailyLimit: 10_000_000_000 });
});

Deno.test("settings that cannot be read fall back to the strict rule, never the loose one", () => {
  assertEquals(shareSettingsFromRow(null), STRICT_SHARE_SETTINGS);
  assertEquals(shareSettingsFromRow({ share_requires_identity: null }), STRICT_SHARE_SETTINGS);
  assertEquals(STRICT_SHARE_SETTINGS.requiresIdentity, true);
  assertEquals(
    shareSettingsFromRow({ share_requires_identity: false, share_daily_limit_l1_kobo: "20000000", share_daily_limit_l2_kobo: 500000000 }),
    gifting,
  );
  // a limit that is missing or not a number is 0, not unlimited
  assertEquals(shareSettingsFromRow({ share_requires_identity: false, share_daily_limit_l1_kobo: "abc" }).l1Kobo, 0);
});

Deno.test("a settings read that fails is not guessed at: sharing waits", () => {
  assertEquals(shareSettingsFromRead(null, { code: "57014", message: "canceling statement due to statement timeout" }), null);
  assertEquals(shareSettingsFromRead(null, { message: "fetch failed" }), null);
});

Deno.test("a database older than 113 (no such column) gets the strict rule", () => {
  assertEquals(
    shareSettingsFromRead(null, { code: "42703", message: "column platform_settings.share_requires_identity does not exist" }),
    STRICT_SHARE_SETTINGS,
  );
});

Deno.test("a good read gives the settings", () => {
  assertEquals(
    shareSettingsFromRead({ share_requires_identity: false, share_daily_limit_l1_kobo: 20000000, share_daily_limit_l2_kobo: 500000000 }, null),
    gifting,
  );
});

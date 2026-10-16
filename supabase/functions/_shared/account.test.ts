import { assertEquals } from "jsr:@std/assert";
import { accountBlock } from "./account.ts";

Deno.test("accountBlock: suspended", () => {
  assertEquals(accountBlock("suspended"), { error: "Your account is suspended. Contact support.", code: "ACCOUNT_SUSPENDED" });
});

Deno.test("accountBlock: banned", () => {
  assertEquals(accountBlock("banned"), { error: "Your account is banned. Contact support.", code: "ACCOUNT_BANNED" });
});

Deno.test("accountBlock: active is not blocked", () => {
  assertEquals(accountBlock("active"), null);
});

Deno.test("accountBlock: missing status is not blocked", () => {
  assertEquals(accountBlock(null), null);
  assertEquals(accountBlock(undefined), null);
});

import { assertEquals } from "jsr:@std/assert";
import { giveawayLimitMessage } from "./giveawayLimit.ts";

Deno.test("the database's limit refusal becomes a sentence with what is left today", () => {
  assertEquals(
    giveawayLimitMessage("GIVEAWAY_DAILY_LIMIT 2000000"),
    "You can give away up to 20,000 more bundles today. Lower the amount or try again tomorrow.",
  );
  // part of a bundle cannot be given, so what is left is rounded down
  assertEquals(
    giveawayLimitMessage("GIVEAWAY_DAILY_LIMIT 150050"),
    "You can give away up to 1,500 more bundles today. Lower the amount or try again tomorrow.",
  );
  // less than the smallest giveaway (100 bundles) left is nothing left: a lower amount would be refused too
  assertEquals(giveawayLimitMessage("GIVEAWAY_DAILY_LIMIT 10000"), "You can give away up to 100 more bundles today. Lower the amount or try again tomorrow.");
  assertEquals(giveawayLimitMessage("GIVEAWAY_DAILY_LIMIT 9999"), "You've reached today's giveaway limit. Try again tomorrow.");
});

Deno.test("nothing left today says so", () => {
  assertEquals(giveawayLimitMessage("GIVEAWAY_DAILY_LIMIT 0"), "You've reached today's giveaway limit. Try again tomorrow.");
  assertEquals(giveawayLimitMessage("GIVEAWAY_DAILY_LIMIT"), "You've reached today's giveaway limit. Try again tomorrow.");
});

Deno.test("other errors are not the limit", () => {
  assertEquals(giveawayLimitMessage("Insufficient balance"), null);
  assertEquals(giveawayLimitMessage(""), null);
});

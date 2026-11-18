import { assertEquals } from "jsr:@std/assert";
import { safeEqual } from "./safeEqual.ts";

Deno.test("safeEqual: equal strings match", () => {
  assertEquals(safeEqual("abc123", "abc123"), true);
  assertEquals(safeEqual("", ""), true);
});

Deno.test("safeEqual: any difference fails, wherever it is", () => {
  assertEquals(safeEqual("abc123", "xbc123"), false);
  assertEquals(safeEqual("abc123", "abc12x"), false);
  assertEquals(safeEqual("abc123", "ABC123"), false);
});

Deno.test("safeEqual: different lengths fail, including a matching prefix", () => {
  assertEquals(safeEqual("abc", "abc123"), false);
  assertEquals(safeEqual("abc123", "abc"), false);
  assertEquals(safeEqual("", "a"), false);
});

Deno.test("safeEqual: characters outside ASCII are compared in full", () => {
  assertEquals(safeEqual("ключ", "ключ"), true);
  assertEquals(safeEqual("ключ", "клюс"), false);
  // "Ā" (U+0100) and "\u0000" share a low byte; they must not match.
  assertEquals(safeEqual("Ā", "\u0000"), false);
});

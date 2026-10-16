import { assertEquals } from "jsr:@std/assert";
import { cleanSearch, orIlike, parsePaging, quoteValue } from "./adminSearch.ts";

Deno.test("cleanSearch trims, caps at 100, and empties blanks", () => {
  assertEquals(cleanSearch("  ada  "), "ada");
  assertEquals(cleanSearch(""), "");
  assertEquals(cleanSearch("   "), "");
  assertEquals(cleanSearch(null), "");
  assertEquals(cleanSearch("x".repeat(150)).length, 100);
});

Deno.test("orIlike quotes values so reserved characters are literal", () => {
  assertEquals(orIlike(["full_name", "email"], "ada"), 'full_name.ilike."%ada%",email.ilike."%ada%"');
  assertEquals(orIlike(["full_name"], "a,b(c)"), 'full_name.ilike."%a,b(c)%"');
  assertEquals(orIlike(["full_name"], 'say "hi"'), 'full_name.ilike."%say \\"hi\\"%"');
});

Deno.test("orIlike escapes LIKE wildcards and backslashes", () => {
  // a_b → LIKE a\_b → PostgREST-escaped a\\_b
  assertEquals(orIlike(["email"], "a_b"), 'email.ilike."%a\\\\_b%"');
  assertEquals(orIlike(["email"], "100%"), 'email.ilike."%100\\\\%%"');
  // one backslash → LIKE \\ → PostgREST \\\\
  assertEquals(orIlike(["email"], "a\\b"), 'email.ilike."%a\\\\\\\\b%"');
});

Deno.test("orIlike is empty when there's nothing to search", () => {
  assertEquals(orIlike(["email"], "   "), "");
  assertEquals(orIlike(["email"], undefined), "");
});

Deno.test("parsePaging never returns NaN, zero or out-of-range values", () => {
  const p = (q: string, o?: { defaultLimit?: number; maxLimit?: number }) => parsePaging(new URLSearchParams(q), o);
  assertEquals(p(""), { page: 1, limit: 50, from: 0, to: 49 });
  assertEquals(p("page=3&limit=20"), { page: 3, limit: 20, from: 40, to: 59 });
  assertEquals(p("page=abc&limit=xyz"), { page: 1, limit: 50, from: 0, to: 49 });
  assertEquals(p("page=0&limit=0"), { page: 1, limit: 50, from: 0, to: 49 });
  assertEquals(p("page=-2&limit=-5"), { page: 1, limit: 50, from: 0, to: 49 });
  assertEquals(p("limit=10000"), { page: 1, limit: 100, from: 0, to: 99 });
  assertEquals(p("page=2.7&limit=10.2"), { page: 2, limit: 10, from: 10, to: 19 });
  assertEquals(p("limit=5000", { maxLimit: 1000 }), { page: 1, limit: 1000, from: 0, to: 999 });
});

Deno.test("quoteValue makes an exact-match value safe inside or()", () => {
  assertEquals(quoteValue("ref-123"), '"ref-123"');
  assertEquals(quoteValue("a,b(c)"), '"a,b(c)"');
  assertEquals(quoteValue('x"y\\z'), '"x\\"y\\\\z"');
});

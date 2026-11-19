import { assertEquals } from "jsr:@std/assert";
import { isSamePersonName } from "./name-match.ts";

Deno.test("the same person: order, case, punctuation and extra middle names do not matter", () => {
  assertEquals(isSamePersonName("John Adebayo", "ADEBAYO JOHN"), true);
  assertEquals(isSamePersonName("John Adebayo", "ADEBAYO, JOHN OLUWASEUN"), true);
  assertEquals(isSamePersonName("John Oluwaseun Adebayo", "Adebayo John"), true);
  assertEquals(isSamePersonName("John Oluwaseun Adebayo", "ADEBAYO JOHN OLUWASEUN PETER"), true);
});

Deno.test("a middle name written as an initial still matches", () => {
  assertEquals(isSamePersonName("John Oluwaseun Adebayo", "ADEBAYO JOHN O"), true);
  assertEquals(isSamePersonName("John O. Adebayo", "Adebayo John Oluwaseun"), true);
});

Deno.test("two shared names are not enough when a third name disagrees", () => {
  // Same family, different person: this passed before (2 of 3 names shared).
  assertEquals(isSamePersonName("John Peter Adebayo", "PETER ADEBAYO SMITH"), false);
  assertEquals(isSamePersonName("Ada Ngozi Obi", "NGOZI OBI EMEKA"), false);
  assertEquals(isSamePersonName("John Oluwaseun Adebayo", "ADEBAYO JOHN PETER"), false);
});

Deno.test("one shared name, or initials alone, never match", () => {
  assertEquals(isSamePersonName("John Adebayo", "ADEBAYO MARY"), false);
  assertEquals(isSamePersonName("John Adebayo", "ADEBAYO"), false);
  assertEquals(isSamePersonName("John Adebayo", "J A"), false);
  assertEquals(isSamePersonName("John Adebayo", "ADEBAYO J"), false);
  assertEquals(isSamePersonName("", "ADEBAYO JOHN"), false);
});

Deno.test("a title on the bank's side is not a name", () => {
  assertEquals(isSamePersonName("John Paul Adebayo", "MR JOHN ADEBAYO"), true);
  assertEquals(isSamePersonName("Amina Bello", "ALHAJA AMINA BELLO"), true);
  assertEquals(isSamePersonName("John Adebayo", "DR. (MRS) JOHN ADEBAYO"), true);
  // a title does not make up for a missing name
  assertEquals(isSamePersonName("John Adebayo", "MR ADEBAYO"), false);
});

Deno.test("single letters are never counted as full names", () => {
  assertEquals(isSamePersonName("J A", "A J"), false);
  assertEquals(isSamePersonName("A B", "B A X"), false);
  assertEquals(isSamePersonName("John A", "A John"), false);
});

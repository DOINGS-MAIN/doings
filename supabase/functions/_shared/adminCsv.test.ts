import { assertEquals } from "jsr:@std/assert";
import { csvCell, toCsv } from "./adminCsv.ts";

Deno.test("a cell that a spreadsheet would run as a formula is made plain text", () => {
  assertEquals(csvCell("=HYPERLINK(\"http://x\")"), "\"'=HYPERLINK(\"\"http://x\"\")\"");
  assertEquals(csvCell("+1+1"), "'+1+1");
  assertEquals(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assertEquals(csvCell("-cmd|' /C calc'!A0"), "'-cmd|' /C calc'!A0");
  assertEquals(csvCell("\t=1+1"), "'\t=1+1");
  assertEquals(csvCell("\r=1+1"), "\"'\r=1+1\"");
});

Deno.test("a formula hidden behind leading spaces is still made plain text", () => {
  assertEquals(csvCell("  =1+1"), "'  =1+1");
});

Deno.test("numbers keep their sign, as numbers or as number text", () => {
  assertEquals(csvCell(-500), "-500");
  assertEquals(csvCell("-500"), "-500");
  assertEquals(csvCell("-12.50"), "-12.50");
  assertEquals(csvCell("+2348012345678"), "+2348012345678");
});

Deno.test("ordinary cells are unchanged; commas, quotes and line breaks are quoted", () => {
  assertEquals(csvCell("Ada Obi"), "Ada Obi");
  assertEquals(csvCell(null), "");
  assertEquals(csvCell(undefined), "");
  assertEquals(csvCell("a,b"), "\"a,b\"");
  assertEquals(csvCell("say \"hi\""), "\"say \"\"hi\"\"\"");
  assertEquals(csvCell("two\nlines"), "\"two\nlines\"");
  assertEquals(csvCell("a\rb"), "\"a\rb\"");
});

Deno.test("toCsv writes the header and one line per row in column order", () => {
  assertEquals(
    toCsv([{ name: "=evil", amount: -5 }, { name: "Ada", amount: 7 }], ["name", "amount"]),
    "name,amount\n'=evil,-5\nAda,7",
  );
});

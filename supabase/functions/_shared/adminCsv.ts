// CSV for admin exports. Names, bank details and webhook fields come from outside; a cell that starts
// with = + - @ (or a tab or line return) is run as a formula when the file is opened in a spreadsheet.
// Such cells get a leading apostrophe, which spreadsheets show as plain text.
const NUMBER_TEXT = /^[+-]?\d+(\.\d+)?$/;
const FORMULA_START = /^(\s*[=+\-@]|[\t\r])/;

export function csvCell(value: unknown): string {
  if (value == null) return "";
  let s = String(value);
  if (typeof value === "string" && !NUMBER_TEXT.test(s) && FORMULA_START.test(s)) s = `'${s}`;
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((col) => csvCell(row[col])).join(","));
  return [header, ...lines].join("\n");
}

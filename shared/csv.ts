/**
 * CSV for files people open in a spreadsheet. Shared by the Worker's
 * active-members export and the chairman's email-list download.
 */

/**
 * A cell a spreadsheet could run as a formula: = + - @ first, after any
 * leading spaces or byte-order mark, in their full-width forms too (some
 * Excel locales read those), or a leading tab, CR or LF.
 */
const FORMULA_START = /^[\s\uFEFF]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/;

/**
 * One CSV cell. Quoted when it has to be, and a cell that could start a
 * formula (FORMULA_START) is prefixed with an apostrophe so a spreadsheet
 * shows it as text instead of running it - these files are opened by
 * people outside the section, and names and addresses are free text.
 */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows to CSV text, CRLF line endings, as spreadsheets expect. */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

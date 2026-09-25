/**
 * CSV for files people open in a spreadsheet. Shared by the Worker's
 * active-members export and the chairman's email-list download.
 */

/**
 * One CSV cell. Quoted when it has to be, and a leading = + - @ (or tab/CR)
 * is prefixed with an apostrophe so a spreadsheet shows it as text instead
 * of running it as a formula - these files are opened by people outside the
 * section, and names and addresses are free text.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows to CSV text, CRLF line endings, as spreadsheets expect. */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

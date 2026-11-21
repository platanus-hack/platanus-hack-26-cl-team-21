// RFC 4180 CSV: comma separator, CRLF line endings, fields quoted only when needed.
// Values are written verbatim (no spreadsheet formula escaping): the file is research data for
// analysis tools, and prefixing cells would alter what was measured.

export type CsvValue = string | number | null;

function field(value: CsvValue): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv<K extends string>(columns: readonly K[], rows: Record<K, CsvValue>[]): string {
  const lines = [columns.map(field).join(",")];
  for (const row of rows) lines.push(columns.map((column) => field(row[column])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

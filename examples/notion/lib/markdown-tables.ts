/** Utilities for preserving table markup in Notion MCP text previews. */

type ParsedCell = {
  text: string;
  header: boolean;
};

const TABLE_PATTERN = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
const ROW_PATTERN = /<(tr|table-row|row)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const CELL_PATTERN = /<(th|td|cell|table-cell)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/** Converts simple HTML/XML table markup into GFM tables for safe Markdown rendering. */
export function normalizeMarkdownTables(markdown: string): string {
  if (!markdown || !/<table\b/i.test(markdown)) {
    return markdown;
  }

  return markdown.replace(TABLE_PATTERN, (original, body: string) => {
    const table = tableMarkupToMarkdown(body);
    return table ? `\n\n${table}\n\n` : original;
  });
}

/** Converts one table body into GFM table text. */
function tableMarkupToMarkdown(markup: string): string | undefined {
  const rows = collectRows(markup);
  if (!rows.length) {
    return undefined;
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  if (!columnCount) {
    return undefined;
  }

  const firstRow = padRow(rows[0] ?? [], columnCount);
  const firstRowIsHeader = firstRow.some((cell) => cell.header);
  const header = firstRowIsHeader
    ? firstRow
    : Array.from({ length: columnCount }, () => ({ text: "", header: true }));
  const body = firstRowIsHeader ? rows.slice(1) : rows;

  return [
    formatMarkdownRow(header),
    formatMarkdownSeparator(columnCount),
    ...body.map((row) => formatMarkdownRow(padRow(row, columnCount))),
  ].join("\n");
}

/** Extracts rows from common table row tags. */
function collectRows(markup: string): ParsedCell[][] {
  return [...markup.matchAll(ROW_PATTERN)]
    .map((match) => collectCells(match[2] ?? ""))
    .filter((row) => row.length > 0);
}

/** Extracts header/data cells from one table row. */
function collectCells(markup: string): ParsedCell[] {
  return [...markup.matchAll(CELL_PATTERN)].map((match) => ({
    header: match[1]?.toLowerCase() === "th",
    text: cleanTableCell(match[2] ?? ""),
  }));
}

/** Pads shorter rows so Markdown table columns stay aligned. */
function padRow(row: ParsedCell[], columnCount: number): ParsedCell[] {
  if (row.length >= columnCount) {
    return row;
  }
  return [
    ...row,
    ...Array.from({ length: columnCount - row.length }, () => ({
      text: "",
      header: false,
    })),
  ];
}

/** Formats a Markdown table row and escapes cell separators. */
function formatMarkdownRow(row: ParsedCell[]): string {
  return `| ${row.map((cell) => cell.text || " ").join(" | ")} |`;
}

/** Formats the required GFM table separator row. */
function formatMarkdownSeparator(columnCount: number): string {
  return `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`;
}

/** Produces compact, Markdown-safe text from a table cell body. */
function cleanTableCell(markup: string): string {
  return decodeBasicEntities(markup)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\|/g, "\\|");
}

/** Decodes the entity subset commonly present in Notion MCP markup. */
function decodeBasicEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

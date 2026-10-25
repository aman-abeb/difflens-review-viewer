import type { DiffFile } from "../parser";

interface Column {
  title: string;
  align: "left" | "right";
  value(file: DiffFile): string;
}

const COLUMN_GAP = "  ";

/** Path shown for a file: `old -> new` for renames, otherwise whichever side exists. */
function fileLabel(file: DiffFile): string {
  const label =
    file.status === "renamed"
      ? `${file.oldPath ?? "?"} -> ${file.newPath ?? "?"}`
      : (file.newPath ?? file.oldPath ?? "(unknown file)");
  return file.binary ? `${label} (binary)` : label;
}

const COLUMNS: readonly Column[] = [
  { title: "STATUS", align: "left", value: (file) => file.status },
  { title: "FILE", align: "left", value: fileLabel },
  { title: "ADD", align: "right", value: (file) => `+${file.additions}` },
  { title: "DEL", align: "right", value: (file) => `-${file.deletions}` },
  { title: "HUNKS", align: "right", value: (file) => String(file.hunks.length) },
];

function pad(text: string, width: number, align: Column["align"]): string {
  return align === "left" ? text.padEnd(width) : text.padStart(width);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Renders parsed diff files as an aligned text table with one row per file
 * (status, path, additions, deletions, hunk count) followed by a totals line.
 * Renamed files are shown as `old -> new` and binary files get a `(binary)` label.
 *
 * @param files - Files returned by `parseDiff`.
 * @returns The multi-line summary, without a trailing newline.
 */
export function formatSummary(files: readonly DiffFile[]): string {
  const layout = COLUMNS.map((column) => ({
    column,
    width: Math.max(column.title.length, ...files.map((file) => column.value(file).length)),
  }));

  const renderRow = (cell: (column: Column) => string): string =>
    layout
      .map(({ column, width }) => pad(cell(column), width, column.align))
      .join(COLUMN_GAP);

  const tableWidth =
    layout.reduce((sum, { width }) => sum + width, 0) + COLUMN_GAP.length * (layout.length - 1);

  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const hunks = files.reduce((sum, file) => sum + file.hunks.length, 0);
  const totals = `${plural(files.length, "file")} changed, +${additions} -${deletions}, ${plural(hunks, "hunk")}`;

  return [
    renderRow((column) => column.title),
    ...files.map((file) => renderRow((column) => column.value(file))),
    "-".repeat(tableWidth),
    totals,
  ].join("\n");
}

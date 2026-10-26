import type { Hunk, Line, LineType } from "../parser";

/** Kind of a side-by-side cell: a diff line type, or padding opposite a missing line. */
export type CellType = LineType | "empty";

/** One half (old or new side) of an aligned row. */
export interface Cell {
  type: CellType;
  /** Line number on this side; `null` for padding cells and for the other side's lines. */
  lineNumber: number | null;
  text: string;
  /** True when the line is followed by a `\ No newline at end of file` marker. */
  noNewlineAtEnd: boolean;
}

/** A single row of the side-by-side view. */
export interface Row {
  left: Cell;
  right: Cell;
}

function emptyCell(): Cell {
  return { type: "empty", lineNumber: null, text: "", noNewlineAtEnd: false };
}

function toCell(line: Line, side: "old" | "new"): Cell {
  return {
    type: line.type,
    lineNumber: side === "old" ? line.oldLineNumber : line.newLineNumber,
    text: line.content,
    noNewlineAtEnd: line.noNewlineAtEnd,
  };
}

/**
 * Aligns the typed lines of a hunk into side-by-side rows.
 *
 * Context lines appear on both sides of one row. Each run of consecutive
 * removed/added lines is paired index by index (first removal next to first
 * addition, and so on); the shorter side is padded with empty cells.
 *
 * @param hunk - A hunk returned by `parseDiff`.
 * @returns The rows to render, top to bottom.
 */
export function alignHunk(hunk: Hunk): Row[] {
  const rows: Row[] = [];
  let removed: Line[] = [];
  let added: Line[] = [];

  const flushChanges = (): void => {
    const count = Math.max(removed.length, added.length);
    for (let index = 0; index < count; index++) {
      const oldLine = removed[index];
      const newLine = added[index];
      rows.push({
        left: oldLine ? toCell(oldLine, "old") : emptyCell(),
        right: newLine ? toCell(newLine, "new") : emptyCell(),
      });
    }
    removed = [];
    added = [];
  };

  for (const line of hunk.lines) {
    if (line.type === "remove") {
      removed.push(line);
    } else if (line.type === "add") {
      added.push(line);
    } else {
      flushChanges();
      rows.push({ left: toCell(line, "old"), right: toCell(line, "new") });
    }
  }
  flushChanges();

  return rows;
}

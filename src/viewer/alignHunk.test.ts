import { describe, expect, it } from "vitest";
import type { Hunk, Line, LineType } from "../parser";
import { alignHunk } from "./alignHunk";

function line(
  type: LineType,
  content: string,
  oldLineNumber: number | null,
  newLineNumber: number | null,
  noNewlineAtEnd = false,
): Line {
  return { type, content, oldLineNumber, newLineNumber, noNewlineAtEnd };
}

function hunk(lines: Line[]): Hunk {
  return { header: "@@ -1 +1 @@", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines };
}

/** Compact view of rows: `[leftType, leftNo, rightType, rightNo]`. */
function shape(h: Hunk): Array<[string, number | null, string, number | null]> {
  return alignHunk(h).map((row) => [
    row.left.type,
    row.left.lineNumber,
    row.right.type,
    row.right.lineNumber,
  ]);
}

describe("alignHunk", () => {
  it("returns no rows for an empty hunk", () => {
    expect(alignHunk(hunk([]))).toEqual([]);
  });

  it("places context lines on both sides with their own line numbers", () => {
    const rows = alignHunk(hunk([line("context", "a", 4, 6), line("context", "b", 5, 7)]));
    expect(rows).toEqual([
      {
        left: { type: "context", lineNumber: 4, text: "a", noNewlineAtEnd: false },
        right: { type: "context", lineNumber: 6, text: "a", noNewlineAtEnd: false },
      },
      {
        left: { type: "context", lineNumber: 5, text: "b", noNewlineAtEnd: false },
        right: { type: "context", lineNumber: 7, text: "b", noNewlineAtEnd: false },
      },
    ]);
  });

  it("pairs one removal with one addition in a single row", () => {
    const rows = alignHunk(
      hunk([line("context", "hello", 1, 1), line("remove", "world", 2, null), line("add", "there", null, 2)]),
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]?.left).toMatchObject({ type: "remove", lineNumber: 2, text: "world" });
    expect(rows[1]?.right).toMatchObject({ type: "add", lineNumber: 2, text: "there" });
  });

  it("pads the right side when there are more removals than additions", () => {
    const h = hunk([
      line("remove", "a", 1, null),
      line("remove", "b", 2, null),
      line("remove", "c", 3, null),
      line("add", "x", null, 1),
    ]);
    expect(shape(h)).toEqual([
      ["remove", 1, "add", 1],
      ["remove", 2, "empty", null],
      ["remove", 3, "empty", null],
    ]);
  });

  it("pads the left side when there are more additions than removals", () => {
    const h = hunk([
      line("remove", "a", 1, null),
      line("add", "x", null, 1),
      line("add", "y", null, 2),
      line("add", "z", null, 3),
    ]);
    expect(shape(h)).toEqual([
      ["remove", 1, "add", 1],
      ["empty", null, "add", 2],
      ["empty", null, "add", 3],
    ]);
  });

  it("handles add-only hunks", () => {
    const h = hunk([line("add", "x", null, 1), line("add", "y", null, 2)]);
    expect(shape(h)).toEqual([
      ["empty", null, "add", 1],
      ["empty", null, "add", 2],
    ]);
  });

  it("handles remove-only hunks", () => {
    const h = hunk([line("remove", "x", 1, null), line("remove", "y", 2, null)]);
    expect(shape(h)).toEqual([
      ["remove", 1, "empty", null],
      ["remove", 2, "empty", null],
    ]);
  });

  it("aligns each change run separately between context lines", () => {
    const h = hunk([
      line("remove", "a", 1, null),
      line("add", "b", null, 1),
      line("context", "keep", 2, 2),
      line("add", "c", null, 3),
      line("remove", "d", 3, null),
    ]);
    expect(shape(h)).toEqual([
      ["remove", 1, "add", 1],
      ["context", 2, "context", 2],
      ["remove", 3, "add", 3],
    ]);
  });

  it("carries the no-newline flag to the matching side only", () => {
    const rows = alignHunk(
      hunk([line("remove", "old", 1, null, true), line("add", "new", null, 1)]),
    );
    expect(rows[0]?.left.noNewlineAtEnd).toBe(true);
    expect(rows[0]?.right.noNewlineAtEnd).toBe(false);
  });

  it("carries the no-newline flag on context lines to both sides", () => {
    const rows = alignHunk(hunk([line("context", "last", 2, 2, true)]));
    expect(rows[0]?.left.noNewlineAtEnd).toBe(true);
    expect(rows[0]?.right.noNewlineAtEnd).toBe(true);
  });
});

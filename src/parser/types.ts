/** Kind of a single line inside a hunk. */
export type LineType = "add" | "remove" | "context";

/** How a file changed between the two sides of the diff. */
export type FileStatus = "added" | "deleted" | "modified" | "renamed";

/** A single line within a hunk, without its leading `+`, `-` or space marker. */
export interface Line {
  type: LineType;
  /** Line text without the diff marker and without line terminator. */
  content: string;
  /** 1-based line number in the old file; `null` for added lines. */
  oldLineNumber: number | null;
  /** 1-based line number in the new file; `null` for removed lines. */
  newLineNumber: number | null;
  /** True when followed by a `\ No newline at end of file` marker. */
  noNewlineAtEnd: boolean;
}

/** A contiguous block of changes introduced by an `@@ ... @@` header. */
export interface Hunk {
  /** The full `@@ -a,b +c,d @@ ...` header line. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: Line[];
}

/** One file entry of a unified diff. */
export interface DiffFile {
  /** Path on the old side; `null` for newly added files. */
  oldPath: string | null;
  /** Path on the new side; `null` for deleted files. */
  newPath: string | null;
  status: FileStatus;
  binary: boolean;
  hunks: Hunk[];
  additions: number;
  deletions: number;
}

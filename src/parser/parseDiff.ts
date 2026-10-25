import type { DiffFile, Hunk, Line } from "./types";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const GIT_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const BINARY_FILES = /^Binary files (.+) and (.+) differ$/;
const DEV_NULL = "/dev/null";

/** Tracks progress through the hunk currently being read. */
interface HunkCursor {
  hunk: Hunk;
  oldLine: number;
  newLine: number;
  oldRemaining: number;
  newRemaining: number;
}

function createFile(oldPath: string | null, newPath: string | null): DiffFile {
  return {
    oldPath,
    newPath,
    status: "modified",
    binary: false,
    hunks: [],
    additions: 0,
    deletions: 0,
  };
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Extracts a path from a `---`/`+++` line. Drops trailing timestamps (after a
 * tab), maps `/dev/null` to `null` and strips git's `a/` / `b/` prefixes.
 */
function parseHeaderPath(raw: string, gitPrefix: "a/" | "b/" | null): string | null {
  const path = raw.split("\t")[0] ?? "";
  if (path === DEV_NULL) {
    return null;
  }
  return gitPrefix && path.startsWith(gitPrefix) ? path.slice(gitPrefix.length) : path;
}

function openHunk(file: DiffFile, header: string, match: RegExpExecArray): HunkCursor {
  const oldStart = Number(match[1]);
  const oldLines = Number(match[2] ?? "1");
  const newStart = Number(match[3]);
  const newLines = Number(match[4] ?? "1");
  const hunk: Hunk = { header, oldStart, oldLines, newStart, newLines, lines: [] };
  file.hunks.push(hunk);
  return {
    hunk,
    oldLine: oldStart,
    newLine: newStart,
    oldRemaining: oldLines,
    newRemaining: newLines,
  };
}

/**
 * Tries to read `line` as part of the active hunk.
 * Returns false when the hunk is complete and the line belongs elsewhere.
 */
function consumeHunkLine(cursor: HunkCursor, line: string, file: DiffFile): boolean {
  const { hunk } = cursor;

  if (line.startsWith("\\")) {
    const previous = hunk.lines[hunk.lines.length - 1];
    if (previous) {
      previous.noNewlineAtEnd = true;
    }
    return true;
  }
  if (cursor.oldRemaining <= 0 && cursor.newRemaining <= 0) {
    return false;
  }

  const content = line.slice(1);
  let parsed: Line;
  switch (line.charAt(0)) {
    case "+":
      parsed = {
        type: "add",
        content,
        oldLineNumber: null,
        newLineNumber: cursor.newLine++,
        noNewlineAtEnd: false,
      };
      cursor.newRemaining--;
      file.additions++;
      break;
    case "-":
      parsed = {
        type: "remove",
        content,
        oldLineNumber: cursor.oldLine++,
        newLineNumber: null,
        noNewlineAtEnd: false,
      };
      cursor.oldRemaining--;
      file.deletions++;
      break;
    case " ":
    case "": // some tools strip the trailing space of blank context lines
      parsed = {
        type: "context",
        content,
        oldLineNumber: cursor.oldLine++,
        newLineNumber: cursor.newLine++,
        noNewlineAtEnd: false,
      };
      cursor.oldRemaining--;
      cursor.newRemaining--;
      break;
    default:
      return false;
  }
  hunk.lines.push(parsed);
  return true;
}

/**
 * Parses unified diff text (as produced by `git diff` or `diff -u`) into files,
 * hunks and typed lines carrying old/new line numbers.
 *
 * Handles multi-file diffs, LF or CRLF line endings, added/deleted/renamed
 * files, binary files, hunk headers with omitted counts, and the
 * `\ No newline at end of file` marker (exposed as `Line.noNewlineAtEnd`).
 * Unrecognised lines outside hunks are ignored.
 *
 * @param text - The raw diff text.
 * @returns One {@link DiffFile} per file, in input order.
 */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let isGit = false;
  let sawOldHeader = false;
  let cursor: HunkCursor | null = null;

  const startFile = (oldPath: string | null, newPath: string | null, git: boolean): DiffFile => {
    const created = createFile(oldPath, newPath);
    files.push(created);
    isGit = git;
    sawOldHeader = false;
    return created;
  };

  for (const line of splitLines(text)) {
    if (cursor && file) {
      if (consumeHunkLine(cursor, line, file)) {
        continue;
      }
      cursor = null;
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      if (file) {
        cursor = openHunk(file, line, hunkMatch);
      }
      continue;
    }

    const gitMatch = GIT_HEADER.exec(line);
    if (gitMatch) {
      file = startFile(gitMatch[1] ?? null, gitMatch[2] ?? null, true);
      continue;
    }

    if (line.startsWith("--- ")) {
      // In plain diffs a second `---` line means a new file starts here.
      if (!file || sawOldHeader) {
        file = startFile(null, null, false);
      }
      file.oldPath = parseHeaderPath(line.slice(4), isGit ? "a/" : null);
      if (file.oldPath === null) {
        file.status = "added";
      }
      sawOldHeader = true;
      continue;
    }

    if (!file) {
      const binaryMatch = BINARY_FILES.exec(line);
      if (binaryMatch) {
        file = startFile(
          parseHeaderPath(binaryMatch[1] ?? "", null),
          parseHeaderPath(binaryMatch[2] ?? "", null),
          false,
        );
        file.binary = true;
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      file.newPath = parseHeaderPath(line.slice(4), isGit ? "b/" : null);
      if (file.newPath === null) {
        file.status = "deleted";
      }
    } else if (line.startsWith("new file mode")) {
      file.status = "added";
      file.oldPath = null;
    } else if (line.startsWith("deleted file mode")) {
      file.status = "deleted";
      file.newPath = null;
    } else if (line.startsWith("rename from ")) {
      file.status = "renamed";
      file.oldPath = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) {
      file.status = "renamed";
      file.newPath = line.slice("rename to ".length);
    } else if (line.startsWith("GIT binary patch") || BINARY_FILES.test(line)) {
      file.binary = true;
    }
  }

  return files;
}

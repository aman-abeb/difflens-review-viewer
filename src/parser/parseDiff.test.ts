import { describe, expect, it } from "vitest";
import basicDiff from "./__fixtures__/basic.diff?raw";
import multiFileDiff from "./__fixtures__/multi-file.diff?raw";
import { parseDiff } from "./parseDiff";

describe("parseDiff: single file", () => {
  const [file, ...rest] = parseDiff(basicDiff);

  it("returns exactly one modified file with its paths", () => {
    expect(rest).toHaveLength(0);
    expect(file?.oldPath).toBe("src/greet.ts");
    expect(file?.newPath).toBe("src/greet.ts");
    expect(file?.status).toBe("modified");
    expect(file?.binary).toBe(false);
  });

  it("tallies additions and deletions", () => {
    expect(file?.additions).toBe(4);
    expect(file?.deletions).toBe(2);
  });

  it("parses hunk ranges", () => {
    expect(file?.hunks).toHaveLength(2);
    const [first, second] = file?.hunks ?? [];
    expect(first).toMatchObject({ oldStart: 1, oldLines: 7, newStart: 1, newLines: 8 });
    expect(second).toMatchObject({ oldStart: 20, oldLines: 3, newStart: 21, newLines: 4 });
    expect(second?.header).toBe("@@ -20,3 +21,4 @@ export function shout(name: string) {");
  });

  it("assigns line types and old/new line numbers", () => {
    const lines = file?.hunks[0]?.lines ?? [];
    const summary = lines.map((l) => [l.type, l.oldLineNumber, l.newLineNumber]);
    expect(summary).toEqual([
      ["context", 1, 1],
      ["context", 2, 2],
      ["remove", 3, null],
      ["remove", 4, null],
      ["add", null, 3],
      ["add", null, 4],
      ["add", null, 5],
      ["context", 5, 6],
      ["context", 6, 7],
      ["context", 7, 8],
    ]);
  });

  it("strips the diff marker from line content", () => {
    const lines = file?.hunks[0]?.lines ?? [];
    expect(lines[0]?.content).toBe('import { format } from "./format";');
    expect(lines[1]?.content).toBe("");
    expect(lines[2]?.content).toBe("export function greet(name) {");
  });

  it("numbers lines in the second hunk from its own header", () => {
    const lines = file?.hunks[1]?.lines ?? [];
    expect(lines.map((l) => [l.type, l.oldLineNumber, l.newLineNumber])).toEqual([
      ["context", 20, 21],
      ["context", 21, 22],
      ["context", 22, 23],
      ["add", null, 24],
    ]);
  });

  it("produces identical results for CRLF input", () => {
    expect(parseDiff(basicDiff.replace(/\n/g, "\r\n"))).toEqual(parseDiff(basicDiff));
  });
});

describe("parseDiff: multi-file", () => {
  const files = parseDiff(multiFileDiff);

  it("splits the diff into one entry per file", () => {
    expect(files.map((f) => f.newPath ?? f.oldPath)).toEqual([
      "src/math.ts",
      "src/math.test.ts",
      "legacy.js",
      "docs/new-name.md",
    ]);
  });

  it("detects added, deleted, modified and renamed files", () => {
    expect(files.map((f) => f.status)).toEqual(["modified", "added", "deleted", "renamed"]);
  });

  it("uses null for the missing side of added and deleted files", () => {
    expect(files[1]?.oldPath).toBeNull();
    expect(files[2]?.newPath).toBeNull();
  });

  it("records both paths of a rename", () => {
    expect(files[3]?.oldPath).toBe("docs/old-name.md");
    expect(files[3]?.newPath).toBe("docs/new-name.md");
  });

  it("counts additions and deletions per file", () => {
    expect(files.map((f) => [f.additions, f.deletions])).toEqual([
      [1, 1],
      [6, 0],
      [0, 2],
      [1, 1],
    ]);
  });

  it("numbers lines of an added file from 1 on the new side only", () => {
    const hunk = files[1]?.hunks[0];
    expect(hunk).toMatchObject({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 6 });
    expect(hunk?.lines.map((l) => [l.oldLineNumber, l.newLineNumber])).toEqual([
      [null, 1],
      [null, 2],
      [null, 3],
      [null, 4],
      [null, 5],
      [null, 6],
    ]);
  });

  it("numbers lines of a deleted file from 1 on the old side only", () => {
    const lines = files[2]?.hunks[0]?.lines ?? [];
    expect(lines.map((l) => [l.type, l.oldLineNumber, l.newLineNumber])).toEqual([
      ["remove", 1, null],
      ["remove", 2, null],
    ]);
  });
});

describe("parseDiff: edge cases", () => {
  it("returns an empty list for empty or non-diff input", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("just some text\nnot a diff\n")).toEqual([]);
  });

  it("defaults omitted hunk counts to 1", () => {
    const diff = ["--- a.txt", "+++ a.txt", "@@ -3 +3 @@", "-old", "+new", ""].join("\n");
    const [file] = parseDiff(diff);
    expect(file?.hunks[0]).toMatchObject({ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1 });
  });

  it("flags lines followed by a 'No newline at end of file' marker", () => {
    const diff = [
      "diff --git a/f.txt b/f.txt",
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1 +1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
      "",
    ].join("\n");
    const lines = parseDiff(diff)[0]?.hunks[0]?.lines ?? [];
    expect(lines).toHaveLength(2);
    expect(lines[0]?.noNewlineAtEnd).toBe(true);
    expect(lines[1]?.noNewlineAtEnd).toBe(false);
  });

  it("marks binary files and keeps them hunk-free", () => {
    const diff = [
      "diff --git a/logo.png b/logo.png",
      "index 1234567..89abcde 100644",
      "Binary files a/logo.png and b/logo.png differ",
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      "",
    ].join("\n");
    const files = parseDiff(diff);
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ binary: true, hunks: [], additions: 0, deletions: 0 });
    expect(files[1]?.binary).toBe(false);
  });

  it("splits plain unified diffs without git headers into files", () => {
    const diff = [
      "--- a/one.txt\t2024-01-01 00:00:00",
      "+++ b/one.txt\t2024-01-02 00:00:00",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "--- two.txt",
      "+++ two.txt",
      "@@ -1 +1,2 @@",
      " c",
      "+d",
      "",
    ].join("\n");
    const files = parseDiff(diff);
    expect(files.map((f) => f.oldPath)).toEqual(["a/one.txt", "two.txt"]);
    expect(files.map((f) => [f.additions, f.deletions])).toEqual([
      [1, 1],
      [1, 0],
    ]);
  });

  it("treats removed lines that look like file headers as content", () => {
    const diff = [
      "diff --git a/notes.md b/notes.md",
      "--- a/notes.md",
      "+++ b/notes.md",
      "@@ -1,2 +1 @@",
      "--- divider",
      " keep",
      "",
    ].join("\n");
    const [file] = parseDiff(diff);
    expect(file?.deletions).toBe(1);
    expect(file?.hunks[0]?.lines[0]).toMatchObject({ type: "remove", content: "-- divider" });
  });

  it("accepts blank context lines whose trailing space was stripped", () => {
    const diff = ["--- a.txt", "+++ a.txt", "@@ -1,3 +1,3 @@", " a", "", "-b", "+c", ""].join("\n");
    const lines = parseDiff(diff)[0]?.hunks[0]?.lines ?? [];
    expect(lines.map((l) => [l.type, l.oldLineNumber, l.newLineNumber])).toEqual([
      ["context", 1, 1],
      ["context", 2, 2],
      ["remove", 3, null],
      ["add", null, 3],
    ]);
  });
});

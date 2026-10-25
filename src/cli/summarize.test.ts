import { describe, expect, it } from "vitest";
import basicDiff from "../parser/__fixtures__/basic.diff?raw";
import noNewlineDiff from "../parser/__fixtures__/no-newline.diff?raw";
import renameBinaryDiff from "../parser/__fixtures__/rename-binary.diff?raw";
import { parseDiff } from "../parser";
import { formatSummary } from "./summarize";

describe("formatSummary", () => {
  it("renders an aligned table for a single modified file", () => {
    const diff = [
      "diff --git a/hello.txt b/hello.txt",
      "--- a/hello.txt",
      "+++ b/hello.txt",
      "@@ -1,2 +1,2 @@",
      " hello",
      "-world",
      "+there",
      "",
    ].join("\n");

    expect(formatSummary(parseDiff(diff))).toBe(
      [
        "STATUS    FILE       ADD  DEL  HUNKS",
        "modified  hello.txt   +1   -1      1",
        "-".repeat(36),
        "1 file changed, +1 -1, 1 hunk",
      ].join("\n"),
    );
  });

  it("shows rename arrows, the binary label and totals", () => {
    const lines = formatSummary(parseDiff(renameBinaryDiff)).split("\n");

    expect(lines).toHaveLength(7);
    expect(lines[1]?.split(/\s+/)).toEqual([
      "renamed",
      "docs/old-name.md",
      "->",
      "docs/new-name.md",
      "+0",
      "-0",
      "0",
    ]);
    expect(lines[2]).toContain("src/util.ts -> src/helpers.ts");
    expect(lines[3]?.split(/\s+/)).toEqual(["added", "assets/logo.png", "(binary)", "+0", "-0", "0"]);
    expect(lines[4]?.split(/\s+/)).toEqual(["deleted", "legacy/old.txt", "+0", "-2", "1"]);
    expect(lines[6]).toBe("4 files changed, +1 -3, 2 hunks");
  });

  it("keeps every column aligned across rows", () => {
    const lines = formatSummary(parseDiff(renameBinaryDiff)).split("\n");
    const table = lines.slice(0, -1);
    expect(new Set(table.map((line) => line.length)).size).toBe(1);
  });

  it("summarizes the no-newline fixture", () => {
    const lines = formatSummary(parseDiff(noNewlineDiff)).split("\n");
    expect(lines[lines.length - 1]).toBe("4 files changed, +5 -4, 4 hunks");
  });

  it("pluralizes totals correctly and counts hunks of multi-hunk files", () => {
    const lines = formatSummary(parseDiff(basicDiff)).split("\n");
    expect(lines[lines.length - 1]).toBe("1 file changed, +4 -2, 2 hunks");
  });

  it("still prints a header and zero totals when there are no files", () => {
    const lines = formatSummary([]).split("\n");
    expect(lines[0]).toBe("STATUS  FILE  ADD  DEL  HUNKS");
    expect(lines[lines.length - 1]).toBe("0 files changed, +0 -0, 0 hunks");
  });
});

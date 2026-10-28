import { describe, expect, it } from "vitest";
import { parseDiff } from "../parser";
import { OfflineReviewer } from "./offlineReviewer";
import { Severity } from "./types";

function createDiff(hunks: string[]): string {
  return [
    "diff --git a/test.ts b/test.ts",
    "--- a/test.ts",
    "+++ b/test.ts",
    ...hunks,
    "",
  ].join("\n");
}

describe("OfflineReviewer", () => {
  const reviewer = new OfflineReviewer();

  describe("detectSecrets", () => {
    it("flags possible secrets in added lines", async () => {
      const diff = createDiff([
        "@@ -1,2 +1,3 @@",
        " context",
        "-old",
        "+const api_key = 'secret123';",
      ]);
      const files = parseDiff(diff);
      const findings = await reviewer.review(files);
      expect(findings).toContainEqual(
        expect.objectContaining({
          severity: Severity.High,
          message: expect.stringContaining("secret or credential"),
        })
      );
    });

    it("detects password patterns", async () => {
      const diff = createDiff([
        "@@ -1 +1,2 @@",
        " code",
        "+password: hunter2",
      ]);
      const findings = await reviewer.review(parseDiff(diff));
      expect(findings.some((f) => f.severity === Severity.High)).toBe(true);
    });

    it("detects token patterns", async () => {
      const diff = createDiff([
        "@@ -1 +1,2 @@",
        " code",
        "+Authorization: Bearer secret_token_xyz",
      ]);
      const findings = await reviewer.review(parseDiff(diff));
      expect(findings.some((f) => f.severity === Severity.High)).toBe(true);
    });

    it("ignores removed secrets (already present before)", async () => {
      const diff = createDiff([
        "@@ -1,2 +1 @@",
        "-const api_key = 'old';",
        " code",
      ]);
      const findings = await reviewer.review(parseDiff(diff));
      expect(findings.filter((f) => f.severity === Severity.High)).toHaveLength(0);
    });

    it("ignores false positives in context lines", async () => {
      const diff = createDiff([
        "@@ -1,2 +1,2 @@",
        " const api_key = 'existing';",
        " code",
      ]);
      const findings = await reviewer.review(parseDiff(diff));
      expect(findings.filter((f) => f.severity === Severity.High)).toHaveLength(0);
    });
  });

  describe("detectDebug", () => {
    it("flags console.log in added lines", async () => {
      const diff = createDiff([
        "@@ -1 +1,2 @@",
        " code",
        "+  console.log(value);",
      ]);
      const findings = await reviewer.review(parseDiff(diff));
      expect(findings).toContainEqual(
        expect.objectContaining({
          severity: Severity.Medium,
          message: expect.stringContaining("Debug statement"),
        })
      );
    });

    it("detects debugger statements", async () => {
      const diff = createDiff([
        "@@ -1 +1,2 @@",
        " code",
        "+debugger;",
      ]);
      const findings = await reviewer.review(parseDiff(diff));
      expect(findings.some((f) => f.severity === Severity.Medium)).toBe(true);
    });

    it("detects console.error", async () => {
      const diff = createDiff([
        "@@ -1 +1,2 @@",
        " code",
        "+console.error(err);",
      ]);
      const findings = await reviewer.review(parseDiff(diff));
      expect(findings.some((f) => f.severity === Severity.Medium)).toBe(true);
    });

    it("ignores removed debug statements", async () => {
      const diff = createDiff([
        "@@ -1,2 +1 @@",
        "-console.log(x);",
        " code",
      ]);
      const findings = await reviewer.review(parseDiff(diff));
      expect(findings.filter((f) => f.severity === Severity.Medium)).toHaveLength(0);
    });
  });

  describe("detectTODO", () => {
    it("flags TODO comments in added lines", async () => {
      const diff = createDiff([
        "@@ -1 +1,2 @@",
        " code",
        "+// TODO: fix this later",
      ]);
      const findings = await reviewer.review(parseDiff(diff));
      expect(findings).toContainEqual(
        expect.objectContaining({
          severity: Severity.Low,
          message: expect.stringContaining("TODO or FIXME"),
        })
      );
    });

    it("detects FIXME comments", async () => {
      const diff = createDiff([
        "@@ -1 +1,2 @@",
        " code",
        "+// FIXME: this is broken",
      ]);
      const findings = await reviewer.review(parseDiff(diff));
      expect(findings.some((f) => f.severity === Severity.Low)).toBe(true);
    });

    it("detects HACK comments", async () => {
      const diff = createDiff([
        "@@ -1 +1,2 @@",
        " code",
        "+// HACK: ugly workaround",
      ]);
      const findings = await reviewer.review(parseDiff(diff));
      expect(findings.some((f) => f.severity === Severity.Low)).toBe(true);
    });

    it("ignores TODO in removed lines", async () => {
      const diff = createDiff([
        "@@ -1,2 +1 @@",
        "-// TODO: old",
        " code",
      ]);
      const findings = await reviewer.review(parseDiff(diff));
      expect(findings.filter((f) => f.severity === Severity.Low)).toHaveLength(0);
    });
  });

  describe("detectDeletedTests", () => {
    it("flags deleted test files with medium severity", async () => {
      const diff = [
        "diff --git a/src/math.test.ts b/src/math.test.ts",
        "deleted file mode 100644",
        "--- a/src/math.test.ts",
        "+++ /dev/null",
        "@@ -1,3 +0,0 @@",
        "-describe('math', () => {});",
        "-test('add', () => {});",
        "-test('sub', () => {});",
        "",
      ].join("\n");
      const files = parseDiff(diff);
      const findings = await reviewer.review(files);
      expect(findings).toContainEqual(
        expect.objectContaining({
          file: "src/math.test.ts",
          line: null,
          severity: Severity.Medium,
          message: expect.stringContaining("Test file deleted"),
        })
      );
    });

    it("detects __tests__ directory files", async () => {
      const diff = [
        "diff --git a/src/__tests__/util.ts b/src/__tests__/util.ts",
        "deleted file mode 100644",
        "--- a/src/__tests__/util.ts",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-export const test = () => {};",
        "",
      ].join("\n");
      const files = parseDiff(diff);
      const findings = await reviewer.review(files);
      expect(findings.some((f) => f.severity === Severity.Medium)).toBe(true);
    });

    it("detects .spec. test files", async () => {
      const diff = [
        "diff --git a/app.spec.ts b/app.spec.ts",
        "deleted file mode 100644",
        "--- a/app.spec.ts",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-test('app');",
        "",
      ].join("\n");
      const files = parseDiff(diff);
      const findings = await reviewer.review(files);
      expect(findings.some((f) => f.severity === Severity.Medium)).toBe(true);
    });

    it("ignores non-test file deletions", async () => {
      const diff = [
        "diff --git a/src/old.ts b/src/old.ts",
        "deleted file mode 100644",
        "--- a/src/old.ts",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-export const old = () => {};",
        "",
      ].join("\n");
      const files = parseDiff(diff);
      const findings = await reviewer.review(files);
      expect(findings.filter((f) => f.severity === Severity.Medium)).toHaveLength(0);
    });
  });

  describe("detectLargeChurn", () => {
    it("flags files with large churn (>100 lines)", async () => {
      const lines_remove = [
        "@@ -1,150 +1,50 @@",
        ...Array.from({ length: 100 }, (_, i) => `-removed ${i + 1}`),
        ...Array.from({ length: 50 }, (_, i) => ` line ${i + 101}`),
        ...Array.from({ length: 50 }, (_, i) => `+added ${i + 1}`),
      ];
      const diff = [
        "diff --git a/large.ts b/large.ts",
        "--- a/large.ts",
        "+++ b/large.ts",
        ...lines_remove,
        "",
      ].join("\n");
      const files = parseDiff(diff);
      const findings = await reviewer.review(files);
      expect(findings).toContainEqual(
        expect.objectContaining({
          severity: Severity.Medium,
          message: expect.stringContaining("Large churn"),
        })
      );
    });

    it("ignores small churn below threshold", async () => {
      const diff = createDiff([
        "@@ -1,10 +1,10 @@",
        " line 1",
        "-line 2",
        "+new line 2",
        " line 3",
      ]);
      const files = parseDiff(diff);
      const findings = await reviewer.review(files);
      expect(findings.filter((f) => f.severity === Severity.Medium)).toHaveLength(0);
    });
  });

  describe("detectLockfileOnly", () => {
    it("flags when only package-lock.json is changed", async () => {
      const diff = [
        "diff --git a/package-lock.json b/package-lock.json",
        "--- a/package-lock.json",
        "+++ b/package-lock.json",
        "@@ -1,5 +1,5 @@",
        ' {\"version\": \"1.0.0\"}',
        '-  \"dependencies\": {}',
        '+  \"dependencies\": {\"new\": \"1.0.0\"}',
        "",
      ].join("\n");
      const files = parseDiff(diff);
      const findings = await reviewer.review(files);
      expect(findings).toContainEqual(
        expect.objectContaining({
          file: "package-lock.json",
          severity: Severity.Low,
          message: expect.stringContaining("lockfile"),
        })
      );
    });

    it("flags yarn.lock-only changes", async () => {
      const diff = [
        "diff --git a/yarn.lock b/yarn.lock",
        "--- a/yarn.lock",
        "+++ b/yarn.lock",
        "@@ -1 +1,2 @@",
        " old",
        "+new",
        "",
      ].join("\n");
      const files = parseDiff(diff);
      const findings = await reviewer.review(files);
      expect(findings.some((f) => f.severity === Severity.Low)).toBe(true);
    });

    it("ignores lockfile changes when source files are also changed", async () => {
      const diff = [
        "diff --git a/src/main.ts b/src/main.ts",
        "--- a/src/main.ts",
        "+++ b/src/main.ts",
        "@@ -1 +1,2 @@",
        " code",
        "+new code",
        "diff --git a/package-lock.json b/package-lock.json",
        "--- a/package-lock.json",
        "+++ b/package-lock.json",
        "@@ -1 +1,2 @@",
        " old",
        "+new",
        "",
      ].join("\n");
      const files = parseDiff(diff);
      const findings = await reviewer.review(files);
      const lockfileFindings = findings.filter((f) => f.file === "package-lock.json");
      expect(lockfileFindings).toHaveLength(0);
    });

    it("detects pnpm-lock.yaml", async () => {
      const diff = [
        "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml",
        "--- a/pnpm-lock.yaml",
        "+++ b/pnpm-lock.yaml",
        "@@ -1 +1,2 @@",
        " old",
        "+new",
        "",
      ].join("\n");
      const files = parseDiff(diff);
      const findings = await reviewer.review(files);
      expect(findings.some((f) => f.file === "pnpm-lock.yaml")).toBe(true);
    });
  });

  describe("integration", () => {
    it("returns multiple findings from different rules", async () => {
      const diff = createDiff([
        "@@ -1,3 +1,5 @@",
        " code",
        "+console.log('debug');",
        "+// TODO: fix this",
        "+const apiKey = 'secret';",
        " more",
      ]);
      const files = parseDiff(diff);
      const findings = await reviewer.review(files);
      expect(findings.length).toBeGreaterThanOrEqual(3);
      expect(findings.map((f) => f.severity)).toContain(Severity.High);
      expect(findings.map((f) => f.severity)).toContain(Severity.Medium);
      expect(findings.map((f) => f.severity)).toContain(Severity.Low);
    });

    it("includes correct line numbers from the new file", async () => {
      const diff = createDiff([
        "@@ -1,2 +1,3 @@",
        " line 1",
        "-removed",
        "+console.log();",
      ]);
      const files = parseDiff(diff);
      const findings = await reviewer.review(files);
      const debugFinding = findings.find((f) => f.message.includes("Debug"));
      expect(debugFinding?.line).toBe(2);
    });

    it("handles empty diffs gracefully", async () => {
      const findings = await reviewer.review([]);
      expect(findings).toEqual([]);
    });
  });
});

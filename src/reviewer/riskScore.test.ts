import { describe, expect, it } from "vitest";
import type { DiffFile } from "../parser";
import { parseDiff } from "../parser";
import { OfflineReviewer } from "./offlineReviewer";
import {
  MAX_RISK_SCORE,
  RISK_THRESHOLDS,
  SEVERITY_WEIGHTS,
  riskLevel,
  scoreAll,
  scoreFile,
} from "./riskScore";
import type { Finding } from "./types";
import { Severity } from "./types";

function diffFile(paths: { oldPath?: string | null; newPath?: string | null }): DiffFile {
  return {
    oldPath: paths.oldPath ?? null,
    newPath: paths.newPath ?? null,
    status: "modified",
    binary: false,
    hunks: [],
    additions: 0,
    deletions: 0,
  };
}

function finding(
  file: string,
  severity: Severity,
  message: string,
  line: number | null = null,
): Finding {
  return { file, line, severity, message };
}

describe("riskLevel", () => {
  it("buckets scores at the threshold boundaries", () => {
    expect(riskLevel(0)).toBe("low");
    expect(riskLevel(RISK_THRESHOLDS.medium - 1)).toBe("low");
    expect(riskLevel(RISK_THRESHOLDS.medium)).toBe("medium");
    expect(riskLevel(RISK_THRESHOLDS.high - 1)).toBe("medium");
    expect(riskLevel(RISK_THRESHOLDS.high)).toBe("high");
    expect(riskLevel(MAX_RISK_SCORE)).toBe("high");
  });
});

describe("scoreFile", () => {
  it("scores a file without findings as 0 / low", () => {
    const risk = scoreFile([], diffFile({ oldPath: "src/a.ts", newPath: "src/a.ts" }));
    expect(risk).toEqual({ path: "src/a.ts", score: 0, level: "low", reasons: [] });
  });

  it("weights findings by severity", () => {
    const file = diffFile({ newPath: "src/a.ts" });
    expect(scoreFile([finding("src/a.ts", Severity.Low, "low")], file).score).toBe(
      SEVERITY_WEIGHTS[Severity.Low],
    );
    expect(scoreFile([finding("src/a.ts", Severity.Medium, "med")], file).score).toBe(
      SEVERITY_WEIGHTS[Severity.Medium],
    );
    expect(scoreFile([finding("src/a.ts", Severity.High, "high")], file).score).toBe(
      SEVERITY_WEIGHTS[Severity.High],
    );
  });

  it("sums the weights of several findings", () => {
    const file = diffFile({ newPath: "src/a.ts" });
    const risk = scoreFile(
      [
        finding("src/a.ts", Severity.High, "secret"),
        finding("src/a.ts", Severity.Medium, "debug"),
        finding("src/a.ts", Severity.Low, "todo"),
      ],
      file,
    );
    expect(risk.score).toBe(
      SEVERITY_WEIGHTS[Severity.High] +
        SEVERITY_WEIGHTS[Severity.Medium] +
        SEVERITY_WEIGHTS[Severity.Low],
    );
    expect(risk.level).toBe("high");
  });

  it("clamps the score at the maximum", () => {
    const findings = Array.from({ length: 10 }, (_, index) =>
      finding("src/a.ts", Severity.High, `secret ${index}`),
    );
    const risk = scoreFile(findings, diffFile({ newPath: "src/a.ts" }));
    expect(risk.score).toBe(MAX_RISK_SCORE);
    expect(risk.level).toBe("high");
  });

  it("orders reasons from most to least severe, keeping input order within a severity", () => {
    const risk = scoreFile(
      [
        finding("src/a.ts", Severity.Low, "TODO added"),
        finding("src/a.ts", Severity.High, "Possible secret"),
        finding("src/a.ts", Severity.Medium, "Debug statement added"),
        finding("src/a.ts", Severity.Medium, "Large churn"),
      ],
      diffFile({ newPath: "src/a.ts" }),
    );
    expect(risk.reasons).toEqual([
      "Possible secret",
      "Debug statement added",
      "Large churn",
      "TODO added",
    ]);
  });

  it("dedupes repeated messages and shows how often they occurred", () => {
    const risk = scoreFile(
      [
        finding("src/a.ts", Severity.Medium, "Debug statement added", 3),
        finding("src/a.ts", Severity.Medium, "Debug statement added", 7),
        finding("src/a.ts", Severity.Low, "TODO added", 9),
      ],
      diffFile({ newPath: "src/a.ts" }),
    );
    expect(risk.reasons).toEqual(["Debug statement added (\u00d72)", "TODO added"]);
    expect(risk.score).toBe(SEVERITY_WEIGHTS[Severity.Medium] * 2 + SEVERITY_WEIGHTS[Severity.Low]);
  });

  it("ignores findings that belong to other files", () => {
    const risk = scoreFile(
      [finding("src/b.ts", Severity.High, "secret")],
      diffFile({ newPath: "src/a.ts" }),
    );
    expect(risk).toMatchObject({ score: 0, level: "low", reasons: [] });
  });

  it("matches findings reported against the old path of a deleted file", () => {
    const risk = scoreFile(
      [finding("src/a.test.ts", Severity.Medium, "Test file deleted")],
      diffFile({ oldPath: "src/a.test.ts", newPath: null }),
    );
    expect(risk.path).toBe("src/a.test.ts");
    expect(risk.reasons).toEqual(["Test file deleted"]);
  });

  it("labels files whose paths are both missing", () => {
    expect(scoreFile([], diffFile({})).path).toBe("(unknown file)");
  });
});

describe("scoreAll", () => {
  it("returns one entry per file, keyed by display path", () => {
    const files = [
      diffFile({ oldPath: "src/a.ts", newPath: "src/a.ts" }),
      diffFile({ oldPath: "src/b.test.ts", newPath: null }),
    ];
    const risks = scoreAll(
      [
        finding("src/a.ts", Severity.High, "Possible secret"),
        finding("src/b.test.ts", Severity.Medium, "Test file deleted"),
      ],
      files,
    );

    expect([...risks.keys()]).toEqual(["src/a.ts", "src/b.test.ts"]);
    expect(risks.get("src/a.ts")?.level).toBe("medium");
    expect(risks.get("src/b.test.ts")?.reasons).toEqual(["Test file deleted"]);
  });

  it("keeps clean files in the map with a zero score", () => {
    const risks = scoreAll([], [diffFile({ newPath: "src/clean.ts" })]);
    expect(risks.get("src/clean.ts")).toEqual({
      path: "src/clean.ts",
      score: 0,
      level: "low",
      reasons: [],
    });
  });

  it("scores the findings of the offline reviewer", async () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,2 +1,5 @@",
      " start",
      "+const api_key = 'abc123';",
      "+console.log(api_key);",
      "+// TODO: remove this",
      " end",
      "",
    ].join("\n");
    const files = parseDiff(diff);
    const findings = await new OfflineReviewer().review(files);

    const risk = scoreAll(findings, files).get("src/app.ts");
    expect(risk?.level).toBe("high");
    expect(risk?.score).toBeGreaterThanOrEqual(RISK_THRESHOLDS.high);
    expect(risk?.reasons[0]).toContain("secret");
    expect(risk?.reasons.join(" ")).toContain("TODO");
  });
});

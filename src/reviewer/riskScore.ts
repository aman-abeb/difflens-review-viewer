import type { DiffFile } from "../parser";
import type { Finding } from "./types";
import { Severity } from "./types";

/** Coarse risk bucket derived from a file's risk score. */
export type RiskLevel = "low" | "medium" | "high";

/** Aggregate risk of a single file, derived from reviewer findings. */
export interface FileRisk {
  /** Display path of the file (new side when present, otherwise old side). */
  path: string;
  /** Risk score between 0 and {@link MAX_RISK_SCORE}. */
  score: number;
  level: RiskLevel;
  /** Human-readable reasons, most severe first, deduped by message. */
  reasons: string[];
}

/** Points contributed by a single finding of each severity. */
export const SEVERITY_WEIGHTS: Readonly<Record<Severity, number>> = {
  [Severity.Low]: 5,
  [Severity.Medium]: 15,
  [Severity.High]: 35,
};

/** Lowest score that still maps to each non-low level. */
export const RISK_THRESHOLDS: Readonly<Record<"medium" | "high", number>> = {
  medium: 20,
  high: 50,
};

/** Scores are clamped to this maximum so a single file cannot exceed 100. */
export const MAX_RISK_SCORE = 100;

/** Severities from most to least severe; drives reason ordering. */
const SEVERITY_ORDER: readonly Severity[] = [Severity.High, Severity.Medium, Severity.Low];

/** Path used to label a file in reports and in the UI. */
function displayPath(file: DiffFile): string {
  return file.newPath ?? file.oldPath ?? "(unknown file)";
}

/**
 * A finding belongs to a file when its path matches either side of the diff:
 * file-level rules (deleted tests) report the old path, line rules the new one.
 */
function belongsTo(finding: Finding, file: DiffFile): boolean {
  return (
    (file.newPath !== null && finding.file === file.newPath) ||
    (file.oldPath !== null && finding.file === file.oldPath) ||
    finding.file === displayPath(file)
  );
}

/** Groups findings by message, keeping their worst severity and first position. */
function collectReasons(findings: readonly Finding[]): string[] {
  interface Group {
    message: string;
    rank: number;
    firstIndex: number;
    count: number;
  }

  const groups = new Map<string, Group>();
  findings.forEach((finding, index) => {
    const rank = SEVERITY_ORDER.indexOf(finding.severity);
    const existing = groups.get(finding.message);
    if (existing) {
      existing.count += 1;
      existing.rank = Math.min(existing.rank, rank);
      return;
    }
    groups.set(finding.message, { message: finding.message, rank, firstIndex: index, count: 1 });
  });

  return [...groups.values()]
    .sort((a, b) => a.rank - b.rank || a.firstIndex - b.firstIndex)
    .map((group) => (group.count > 1 ? `${group.message} (\u00d7${group.count})` : group.message));
}

/**
 * Maps a raw score to its risk level using {@link RISK_THRESHOLDS}.
 *
 * @param score - A score between 0 and {@link MAX_RISK_SCORE}.
 * @returns `"high"`, `"medium"` or `"low"`.
 */
export function riskLevel(score: number): RiskLevel {
  if (score >= RISK_THRESHOLDS.high) {
    return "high";
  }
  return score >= RISK_THRESHOLDS.medium ? "medium" : "low";
}

/**
 * Aggregates the findings that belong to one file into a risk score.
 *
 * Each finding adds the points of its severity ({@link SEVERITY_WEIGHTS}); the
 * total is clamped to {@link MAX_RISK_SCORE} and bucketed into a level. Reasons
 * are the finding messages, deduped (repeats get a `(×n)` suffix) and ordered
 * from most to least severe.
 *
 * @param findings - All findings returned by a reviewer, for any file.
 * @param file - The file to score.
 * @returns The file's risk; a file without findings scores 0 and is `"low"`.
 */
export function scoreFile(findings: readonly Finding[], file: DiffFile): FileRisk {
  const own = findings.filter((finding) => belongsTo(finding, file));
  const total = own.reduce((sum, finding) => sum + SEVERITY_WEIGHTS[finding.severity], 0);
  const score = Math.min(total, MAX_RISK_SCORE);

  return {
    path: displayPath(file),
    score,
    level: riskLevel(score),
    reasons: collectReasons(own),
  };
}

/**
 * Scores every file of a diff.
 *
 * @param findings - All findings returned by a reviewer.
 * @param files - Files returned by `parseDiff`.
 * @returns A map from display path to {@link FileRisk}, with one entry per file.
 */
export function scoreAll(
  findings: readonly Finding[],
  files: readonly DiffFile[],
): Map<string, FileRisk> {
  return new Map(files.map((file) => [displayPath(file), scoreFile(findings, file)]));
}

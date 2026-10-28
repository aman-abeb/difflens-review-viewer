import type { DiffFile } from "../parser";

/** Severity level of a finding. */
export enum Severity {
  Low = "low",
  Medium = "medium",
  High = "high",
}

/** A single issue found by a reviewer. */
export interface Finding {
  /** Path of the file containing the issue. */
  file: string;
  /** 1-based line number in the new file; `null` for file-level findings. */
  line: number | null;
  severity: Severity;
  /** Human-readable description of the issue. */
  message: string;
}

/** Pluggable interface for risk assessment of diffs. */
export interface Reviewer {
  /**
   * Analyzes parsed diff files and returns findings with severity levels.
   * @param files - Files returned by `parseDiff`.
   * @returns Promise resolving to findings, in any order.
   */
  review(files: DiffFile[]): Promise<Finding[]>;
}

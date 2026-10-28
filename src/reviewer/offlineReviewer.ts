import type { DiffFile } from "../parser";
import type { Finding, Reviewer } from "./types";
import { Severity } from "./types";

/**
 * Detects patterns that often indicate secrets or credentials.
 * Looks for common key patterns like `api_key=`, `password:`, etc.
 */
function detectSecrets(file: DiffFile): Finding[] {
  const findings: Finding[] = [];
  const secretPatterns =
    /(?:api[_-]?key|password|secret|token|credential|auth|apikey|private[_-]?key|aws[_-]?key|bearer[\s:]+)/i;

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add" && secretPatterns.test(line.content)) {
        findings.push({
          file: file.newPath ?? file.oldPath ?? "(unknown)",
          line: line.newLineNumber,
          severity: Severity.High,
          message: "Possible secret or credential in added line",
        });
      }
    }
  }

  return findings;
}

/**
 * Detects common debugging constructs added to the code.
 * Looks for console.log, debugger statements, console.error, etc.
 */
function detectDebug(file: DiffFile): Finding[] {
  const findings: Finding[] = [];
  const debugPatterns = /(?:console\.(?:log|error|warn|debug)|debugger|console\.trace)/i;

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add" && debugPatterns.test(line.content)) {
        findings.push({
          file: file.newPath ?? file.oldPath ?? "(unknown)",
          line: line.newLineNumber,
          severity: Severity.Medium,
          message: "Debug statement added",
        });
      }
    }
  }

  return findings;
}

/**
 * Detects TODO and FIXME comments added to code.
 */
function detectTODO(file: DiffFile): Finding[] {
  const findings: Finding[] = [];
  const todoPattern = /\b(?:TODO|FIXME|XXX|HACK|BUG)\b/i;

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add" && todoPattern.test(line.content)) {
        findings.push({
          file: file.newPath ?? file.oldPath ?? "(unknown)",
          line: line.newLineNumber,
          severity: Severity.Low,
          message: "TODO or FIXME comment added",
        });
      }
    }
  }

  return findings;
}

/**
 * Detects when test files are deleted, which may indicate incomplete refactoring.
 */
function detectDeletedTests(file: DiffFile): Finding[] {
  if (file.status !== "deleted" && file.deletions === 0) {
    return [];
  }

  const filePath = file.oldPath ?? file.newPath ?? "";
  const isTestFile =
    /(?:\.test\.|_test\.|\/__tests__\/|test\/|tests\/|\.spec\.)/i.test(filePath);

  if (!isTestFile) {
    return [];
  }

  return [
    {
      file: filePath,
      line: null,
      severity: Severity.Medium,
      message: `Test file ${file.status === "deleted" ? "deleted" : "modified"}; verify test coverage is maintained`,
    },
  ];
}

/**
 * Detects large file churn (many additions and deletions), which may indicate
 * refactoring, cleanup or high-risk changes.
 */
function detectLargeChurn(file: DiffFile): Finding[] {
  const totalChurn = file.additions + file.deletions;
  const LARGE_CHURN_THRESHOLD = 100;

  if (totalChurn < LARGE_CHURN_THRESHOLD) {
    return [];
  }

  const filePath = file.newPath ?? file.oldPath ?? "(unknown)";
  return [
    {
      file: filePath,
      line: null,
      severity: Severity.Medium,
      message: `Large churn: ${file.additions} additions, ${file.deletions} deletions; review carefully for unintended changes`,
    },
  ];
}

/**
 * Detects lockfile-only changes, which might indicate dependency updates
 * without corresponding source code changes.
 */
function detectLockfileOnly(files: DiffFile[]): Finding[] {
  const lockfilePatterns = /(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Gemfile\.lock|Cargo\.lock|go\.sum)/i;
  const lockfileFiles = files.filter((f) =>
    lockfilePatterns.test(f.newPath ?? f.oldPath ?? "")
  );

  const nonLockfiles = files.filter(
    (f) => !lockfilePatterns.test(f.newPath ?? f.oldPath ?? "")
  );

  if (lockfileFiles.length > 0 && nonLockfiles.length === 0) {
    return lockfileFiles.map((f) => ({
      file: f.newPath ?? f.oldPath ?? "(unknown)",
      line: null,
      severity: Severity.Low,
      message:
        "Only dependency lockfile changed; verify intent and review dependency updates",
    }));
  }

  return [];
}

/**
 * Offline, rule-based reviewer that applies heuristics to detect common issues:
 * - Secrets-like strings (api_key, password, token, etc.)
 * - Debug statements (console.log, debugger, etc.)
 * - TODO/FIXME comments
 * - Deleted test files
 * - Large churn (>100 lines changed)
 * - Lockfile-only changes
 */
export class OfflineReviewer implements Reviewer {
  async review(files: DiffFile[]): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const file of files) {
      findings.push(...detectSecrets(file));
      findings.push(...detectDebug(file));
      findings.push(...detectTODO(file));
      findings.push(...detectDeletedTests(file));
      findings.push(...detectLargeChurn(file));
    }

    findings.push(...detectLockfileOnly(files));

    return findings;
  }
}

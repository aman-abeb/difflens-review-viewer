import { useId, useState } from "react";
import type { ReactElement } from "react";
import type { DiffFile } from "../parser";
import { alignHunk } from "./alignHunk";
import type { Cell } from "./alignHunk";
import "./viewer.css";

const NO_NEWLINE_MARKER = "\\ No newline at end of file";

/** Human-readable label for a file, showing both paths for renames. */
function fileLabel(file: DiffFile): string {
  if (file.status === "renamed") {
    return `${file.oldPath ?? "?"} → ${file.newPath ?? "?"}`;
  }
  return file.newPath ?? file.oldPath ?? "(unknown file)";
}

interface CellsProps {
  cell: Cell;
}

/** A line-number gutter cell and its code cell for one side of a row. */
function SideCells({ cell }: CellsProps): ReactElement {
  return (
    <>
      <td className={`diff-num diff-${cell.type}`}>{cell.lineNumber}</td>
      <td className={`diff-code diff-${cell.type}`}>
        {cell.text}
        {cell.noNewlineAtEnd && <div className="diff-no-newline">{NO_NEWLINE_MARKER}</div>}
      </td>
    </>
  );
}

function FileBody({ file }: { file: DiffFile }): ReactElement {
  if (file.binary) {
    return <p className="diff-placeholder diff-binary">Binary file</p>;
  }
  if (file.hunks.length === 0) {
    return <p className="diff-placeholder">No content changes</p>;
  }
  return (
    <>
      {file.hunks.map((hunk, hunkIndex) => (
        <table className="diff-table" key={`${hunk.header}-${hunkIndex}`} aria-label={hunk.header}>
          <colgroup>
            <col className="diff-col-num" />
            <col className="diff-col-code" />
            <col className="diff-col-num" />
            <col className="diff-col-code" />
          </colgroup>
          <tbody>
            <tr className="diff-hunk-header" data-testid="diff-hunk-header">
              <td colSpan={4}>{hunk.header}</td>
            </tr>
            {alignHunk(hunk).map((row, rowIndex) => (
              <tr key={rowIndex} data-testid="diff-row">
                <SideCells cell={row.left} />
                <SideCells cell={row.right} />
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </>
  );
}

/** Props of {@link SideBySideFile}. */
export interface SideBySideFileProps {
  file: DiffFile;
  /**
   * Controlled collapsed state. When omitted the component keeps its own
   * state, starting expanded.
   */
  collapsed?: boolean;
  /** Called when the header toggle is clicked, in both controlled and uncontrolled mode. */
  onToggle?: () => void;
}

/**
 * Renders one parsed file as a side-by-side diff: a header with the path,
 * status, churn and a collapse toggle (`aria-expanded`), then one table per
 * hunk with old and new line numbers and text in aligned columns. Binary files
 * show a placeholder instead of hunks. Collapsing hides the body but keeps the
 * header and its churn stats visible.
 */
export function SideBySideFile({ file, collapsed, onToggle }: SideBySideFileProps): ReactElement {
  const label = fileLabel(file);
  const bodyId = useId();
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = collapsed ?? internalCollapsed;

  const handleToggle = (): void => {
    if (collapsed === undefined) {
      setInternalCollapsed((current) => !current);
    }
    onToggle?.();
  };

  return (
    <section
      className={isCollapsed ? "diff-file diff-file-collapsed" : "diff-file"}
      data-testid="diff-file"
      aria-label={`Diff of ${label}`}
    >
      <header className="diff-file-header">
        <button
          type="button"
          className="diff-toggle"
          aria-expanded={!isCollapsed}
          aria-controls={isCollapsed ? undefined : bodyId}
          aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${label}`}
          onClick={handleToggle}
        >
          {isCollapsed ? "▸" : "▾"}
        </button>
        <h2 className="diff-file-path">{label}</h2>
        <span className={`diff-status diff-status-${file.status}`}>{file.status}</span>
        {!file.binary && (
          <span className="diff-churn">{`+${file.additions} -${file.deletions}`}</span>
        )}
      </header>
      {!isCollapsed && (
        <div id={bodyId} className="diff-file-body">
          <FileBody file={file} />
        </div>
      )}
    </section>
  );
}

import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { parseDiff } from "./parser";
import type { DiffFile } from "./parser";

/** Human-readable label for a file, showing both paths for renames. */
function fileLabel(file: DiffFile): string {
  if (file.status === "renamed") {
    return `${file.oldPath ?? "?"} → ${file.newPath ?? "?"}`;
  }
  return file.newPath ?? file.oldPath ?? "(unknown file)";
}

/**
 * Placeholder shell: paste a unified diff and see a per-file summary.
 * The side-by-side viewer replaces the summary list in the next milestone.
 */
export function App(): ReactElement {
  const [text, setText] = useState("");
  const files = useMemo(() => parseDiff(text), [text]);

  return (
    <main>
      <h1>DiffLens</h1>
      <textarea
        aria-label="Unified diff"
        placeholder="Paste a unified diff here"
        rows={12}
        cols={80}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <ul aria-label="Files">
        {files.map((file, index) => (
          <li key={`${fileLabel(file)}-${index}`}>
            {fileLabel(file)}{" "}
            <span>
              {file.binary ? "binary" : `+${file.additions} -${file.deletions}`}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}

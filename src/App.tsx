import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { parseDiff } from "./parser";
import basicDiff from "./parser/__fixtures__/basic.diff?raw";
import { SideBySideFile } from "./viewer";

/**
 * Shell around the side-by-side viewer. It starts with the basic sample diff
 * and re-renders when a different unified diff is pasted into the textarea.
 */
export function App(): ReactElement {
  const [text, setText] = useState(basicDiff);
  const files = useMemo(() => parseDiff(text), [text]);

  return (
    <main>
      <h1>DiffLens</h1>
      <textarea
        aria-label="Unified diff"
        placeholder="Paste a unified diff here"
        rows={8}
        cols={80}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {files.map((file, index) => (
        <SideBySideFile key={`${file.oldPath ?? ""}>${file.newPath ?? ""}#${index}`} file={file} />
      ))}
    </main>
  );
}

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

const DIFF = [
  "diff --git a/hello.txt b/hello.txt",
  "--- a/hello.txt",
  "+++ b/hello.txt",
  "@@ -1,2 +1,2 @@",
  " hello",
  "-world",
  "+there",
  "",
].join("\n");

describe("App", () => {
  afterEach(cleanup);

  it("renders the basic sample diff side by side by default", () => {
    render(<App />);
    expect(screen.getAllByTestId("diff-file")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "src/greet.ts" })).toBeTruthy();
    expect(screen.getAllByTestId("diff-row")).toHaveLength(12);
  });

  it("re-renders the viewer after pasting a different diff", () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Unified diff"), {
      target: { value: DIFF },
    });
    expect(screen.getByRole("heading", { name: "hello.txt" })).toBeTruthy();
    const rows = screen.getAllByTestId("diff-row");
    expect(rows).toHaveLength(2);
    expect(rows[1]?.textContent).toContain("world");
    expect(rows[1]?.textContent).toContain("there");
  });

  it("renders no files when the textarea is cleared", () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Unified diff"), {
      target: { value: "" },
    });
    expect(screen.queryAllByTestId("diff-file")).toHaveLength(0);
  });
});

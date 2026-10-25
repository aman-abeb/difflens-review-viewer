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

  it("renders no files before a diff is pasted", () => {
    render(<App />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("lists parsed files with churn after pasting a diff", () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("Unified diff"), {
      target: { value: DIFF },
    });
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("hello.txt");
    expect(items[0]?.textContent).toContain("+1 -1");
  });
});

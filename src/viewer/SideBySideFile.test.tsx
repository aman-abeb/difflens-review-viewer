import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import basicDiff from "../parser/__fixtures__/basic.diff?raw";
import noNewlineDiff from "../parser/__fixtures__/no-newline.diff?raw";
import renameBinaryDiff from "../parser/__fixtures__/rename-binary.diff?raw";
import { parseDiff } from "../parser";
import type { DiffFile } from "../parser";
import { SideBySideFile } from "./SideBySideFile";

function fileAt(diff: string, index: number): DiffFile {
  const file = parseDiff(diff)[index];
  if (!file) {
    throw new Error(`fixture has no file at index ${index}`);
  }
  return file;
}

/** Cells of a row as `[oldNo, oldText, newNo, newText]` elements. */
function cellsOf(row: HTMLElement): HTMLElement[] {
  return within(row).getAllByRole("cell");
}

function texts(row: HTMLElement): string[] {
  return cellsOf(row).map((cell) => cell.textContent ?? "");
}

describe("SideBySideFile", () => {
  afterEach(cleanup);

  it("renders the path, status and churn in the header", () => {
    render(<SideBySideFile file={fileAt(basicDiff, 0)} />);
    expect(screen.getByRole("heading", { name: "src/greet.ts" })).toBeTruthy();
    expect(screen.getByText("modified")).toBeTruthy();
    expect(screen.getByText("+4 -2")).toBeTruthy();
  });

  it("renders one hunk header and table per hunk", () => {
    render(<SideBySideFile file={fileAt(basicDiff, 0)} />);
    expect(screen.getAllByRole("table")).toHaveLength(2);
    const headers = screen.getAllByTestId("diff-hunk-header").map((el) => el.textContent);
    expect(headers).toEqual([
      "@@ -1,7 +1,8 @@",
      "@@ -20,3 +21,4 @@ export function shout(name: string) {",
    ]);
  });

  it("aligns removed and added lines in shared rows with padding", () => {
    render(<SideBySideFile file={fileAt(basicDiff, 0)} />);
    const rows = screen.getAllByTestId("diff-row");
    expect(rows).toHaveLength(12);

    const replaced = cellsOf(rows[2] as HTMLElement);
    expect(replaced[1]?.className).toContain("diff-remove");
    expect(replaced[1]?.textContent).toBe("export function greet(name) {");
    expect(replaced[3]?.className).toContain("diff-add");

    const addOnly = cellsOf(rows[4] as HTMLElement);
    expect(addOnly[0]?.className).toContain("diff-empty");
    expect(addOnly[1]?.className).toContain("diff-empty");
    expect(addOnly[1]?.textContent).toBe("");
    expect(addOnly[3]?.className).toContain("diff-add");
  });

  it("shows the correct old and new line numbers on every row", () => {
    render(<SideBySideFile file={fileAt(basicDiff, 0)} />);
    const numbers = screen.getAllByTestId("diff-row").map((row) => {
      const cells = cellsOf(row);
      return [cells[0]?.textContent, cells[2]?.textContent];
    });
    expect(numbers).toEqual([
      ["1", "1"],
      ["2", "2"],
      ["3", "3"],
      ["4", "4"],
      ["", "5"],
      ["5", "6"],
      ["6", "7"],
      ["7", "8"],
      ["20", "21"],
      ["21", "22"],
      ["22", "23"],
      ["", "24"],
    ]);
  });

  it("renders context lines identically on both sides", () => {
    render(<SideBySideFile file={fileAt(basicDiff, 0)} />);
    const first = texts(screen.getAllByTestId("diff-row")[0] as HTMLElement);
    expect(first).toEqual(["1", 'import { format } from "./format";', "1", 'import { format } from "./format";']);
    const cells = cellsOf(screen.getAllByTestId("diff-row")[0] as HTMLElement);
    expect(cells.every((cell) => cell.className.includes("diff-context"))).toBe(true);
  });

  it("shows old and new paths for a rename", () => {
    render(<SideBySideFile file={fileAt(renameBinaryDiff, 1)} />);
    expect(screen.getByRole("heading", { name: "src/util.ts → src/helpers.ts" })).toBeTruthy();
    expect(screen.getByText("renamed")).toBeTruthy();
    // context, one paired remove/add row, context
    expect(screen.getAllByTestId("diff-row")).toHaveLength(3);
  });

  it("notes a pure rename without hunks", () => {
    render(<SideBySideFile file={fileAt(renameBinaryDiff, 0)} />);
    expect(screen.getByRole("heading", { name: "docs/old-name.md → docs/new-name.md" })).toBeTruthy();
    expect(screen.getByText("No content changes")).toBeTruthy();
    expect(screen.queryAllByRole("table")).toHaveLength(0);
  });

  it("shows a placeholder instead of hunks for binary files", () => {
    render(<SideBySideFile file={fileAt(renameBinaryDiff, 2)} />);
    expect(screen.getByText("Binary file")).toBeTruthy();
    expect(screen.queryAllByRole("table")).toHaveLength(0);
    expect(screen.queryByText(/^\+\d+ -\d+$/)).toBeNull();
  });

  it("marks a missing trailing newline on the affected side", () => {
    render(<SideBySideFile file={fileAt(noNewlineDiff, 0)} />);
    const markers = screen.getAllByText("\\ No newline at end of file");
    expect(markers).toHaveLength(1);
    expect(markers[0]?.closest("td")?.className).toContain("diff-remove");
  });

  it("marks both sides when neither has a trailing newline", () => {
    render(<SideBySideFile file={fileAt(noNewlineDiff, 2)} />);
    const markers = screen.getAllByText("\\ No newline at end of file");
    expect(markers).toHaveLength(2);
    expect(markers.map((m) => m.closest("td")?.className.includes("diff-remove"))).toEqual([true, false]);
    expect(markers[1]?.closest("td")?.className).toContain("diff-add");
  });
});

describe("SideBySideFile collapsing", () => {
  afterEach(cleanup);

  it("starts expanded with an aria-expanded toggle in the header", () => {
    render(<SideBySideFile file={fileAt(basicDiff, 0)} />);
    const toggle = screen.getByRole("button", { name: "Collapse src/greet.ts" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("table")).toHaveLength(2);
  });

  it("hides the hunks and flips aria-expanded when the toggle is clicked", () => {
    render(<SideBySideFile file={fileAt(basicDiff, 0)} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse src/greet.ts" }));

    const toggle = screen.getByRole("button", { name: "Expand src/greet.ts" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByRole("table")).toHaveLength(0);
    expect(screen.queryAllByTestId("diff-row")).toHaveLength(0);
  });

  it("keeps the heading, status and churn stats visible while collapsed", () => {
    render(<SideBySideFile file={fileAt(basicDiff, 0)} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse src/greet.ts" }));
    expect(screen.getByRole("heading", { name: "src/greet.ts" })).toBeTruthy();
    expect(screen.getByText("modified")).toBeTruthy();
    expect(screen.getByText("+4 -2")).toBeTruthy();
  });

  it("expands again on a second click", () => {
    render(<SideBySideFile file={fileAt(basicDiff, 0)} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse src/greet.ts" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand src/greet.ts" }));
    expect(screen.getAllByTestId("diff-row")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Collapse src/greet.ts" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("hides placeholders for binary files when collapsed", () => {
    render(<SideBySideFile file={fileAt(renameBinaryDiff, 2)} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse assets/logo.png" }));
    expect(screen.queryByText("Binary file")).toBeNull();
  });

  it("follows the collapsed prop and reports clicks through onToggle when controlled", () => {
    const onToggle = vi.fn();
    const file = fileAt(basicDiff, 0);
    const { rerender } = render(<SideBySideFile file={file} collapsed onToggle={onToggle} />);
    expect(screen.queryAllByRole("table")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Expand src/greet.ts" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    // Still collapsed: the parent owns the state and has not changed it.
    expect(screen.queryAllByRole("table")).toHaveLength(0);

    rerender(<SideBySideFile file={file} collapsed={false} onToggle={onToggle} />);
    expect(screen.getAllByRole("table")).toHaveLength(2);
  });
});

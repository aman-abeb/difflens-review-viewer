# DiffLens

<!-- builder:badges:start -->
[![CI](https://github.com/aman-abeb/difflens-review-viewer/actions/workflows/ci.yml/badge.svg)](https://github.com/aman-abeb/difflens-review-viewer/actions/workflows/ci.yml) ![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6?logo=typescript&logoColor=white) ![React](https://img.shields.io/badge/react-61DAFB?logo=react&logoColor=black) ![Vite](https://img.shields.io/badge/vite-646CFF?logo=vite&logoColor=white) ![License: MIT](https://img.shields.io/badge/license-MIT-green)
<!-- builder:badges:end -->


A TypeScript web tool that parses unified git diffs and renders a side-by-side review view with per-file risk scores and an offline heuristic reviewer.

## Features

- Unified diff parser (`src/parser`) producing files, hunks and typed lines with old/new line numbers
- Handles multi-file diffs, added/deleted/renamed files, binary files, CRLF input, hunk headers without counts and `\ No newline at end of file` markers
- Per-file `additions` / `deletions` totals
- CLI summary: pipe any diff into `npm run summarize` for a per-file table of status, additions, deletions and hunks
- Minimal React shell: paste a diff and see a per-file summary (the side-by-side viewer, risk scoring and reviewers are still to be built)

## Quickstart

```bash
npm install
npm run dev       # start the Vite dev server
npm run build     # type-check and build
npm start         # preview the production build
npm test
```

Summarize a diff from the command line:

```bash
git diff | npm run summarize --silent
git diff main...HEAD | npm run summarize --silent
```

The script exits with status 1 and a message on stderr when stdin is empty, is a terminal, or contains no diff.

## Example

`parseDiff` on this diff:

```diff
diff --git a/hello.txt b/hello.txt
--- a/hello.txt
+++ b/hello.txt
@@ -1,2 +1,2 @@
 hello
-world
+there
```

returns:

```json
[
  {
    "oldPath": "hello.txt",
    "newPath": "hello.txt",
    "status": "modified",
    "binary": false,
    "hunks": [
      {
        "header": "@@ -1,2 +1,2 @@",
        "oldStart": 1,
        "oldLines": 2,
        "newStart": 1,
        "newLines": 2,
        "lines": [
          { "type": "context", "content": "hello", "oldLineNumber": 1, "newLineNumber": 1, "noNewlineAtEnd": false },
          { "type": "remove", "content": "world", "oldLineNumber": 2, "newLineNumber": null, "noNewlineAtEnd": false },
          { "type": "add", "content": "there", "oldLineNumber": null, "newLineNumber": 2, "noNewlineAtEnd": false }
        ]
      }
    ],
    "additions": 1,
    "deletions": 1
  }
]
```

### CLI summary

Running the summarizer on `src/parser/__fixtures__/rename-binary.diff` (a pure rename, a rename with edits, a new binary file and a deleted file):

```bash
npm run summarize --silent < src/parser/__fixtures__/rename-binary.diff
```

```text
STATUS   FILE                                    ADD  DEL  HUNKS
renamed  docs/old-name.md -> docs/new-name.md   +0   -0      0
renamed  src/util.ts -> src/helpers.ts           +1   -1      1
added    assets/logo.png (binary)                +0   -0      0
deleted  legacy/old.txt                          +0   -2      1
--------------------------------------------------------------
4 files changed, +1 -3, 2 hunks
```

## How it works

`parseDiff(text)` in `src/parser/parseDiff.ts` is a line-by-line state machine:

1. Input is split on LF/CRLF.
2. Inside a hunk, the `@@ -a,b +c,d @@` counts decide how many lines belong to it. Because of this, a removed line like `--- divider` is not mistaken for a file header.
3. Outside hunks, `diff --git`, `---`/`+++`, `new file mode`, `deleted file mode`, `rename from/to` and `Binary files ... differ` lines set the file's paths, status and binary flag. Plain `diff -u` output without git headers is also split into files.
4. A `\ No newline at end of file` marker sets `noNewlineAtEnd` on the preceding line instead of becoming a line of its own.

Types live in `src/parser/types.ts`; `src/parser/index.ts` is the public entry point.

The CLI is split into a pure formatter and a thin I/O wrapper: `formatSummary(files)` in `src/cli/summarize.ts` builds the aligned table and totals line (and is unit-tested), while `scripts/summarize.ts` reads stdin, calls `parseDiff` and `formatSummary`, and sets the exit code. It runs through `tsx` via `npm run summarize`.

## Running tests

```bash
npm test
```

Tests run with Vitest and jsdom, fully offline, using fixture diffs in `src/parser/__fixtures__` (basic, multi-file, rename/binary/deleted and no-newline cases).

<!-- builder:roadmap:start -->
## Status

**In active development:** 0 of 3 milestones done.

## Roadmap

- [ ] **Unified diff parser and CLI summary**: Set up Vite + TypeScript + Vitest. Implement a unified diff parser producing files, hunks, and typed lines with old/new line numbers; handle renames, new/deleted files, binary files, and no-newline markers. Add fixture diffs and thorough unit tests, plus a small Node script that prints a per-file summary (additions, deletions, hunks) from a diff on stdin.
- [ ] **Side-by-side React viewer**: Build the React UI: paste/upload a diff, file list sidebar with churn stats, and a side-by-side hunk view that aligns removed and added lines, highlights intra-line word changes, and supports collapsing files. Add component tests with Testing Library for alignment, line numbers, and collapse behavior, and include sample diffs to load with one click.
- [ ] **Risk scoring and pluggable reviewer**: Define a Reviewer interface returning findings with file, line, severity, and message. Implement the offline rule-based reviewer (secrets-like strings, debug statements, TODO/FIXME, deleted tests, large churn, lockfile-only changes) and an aggregate per-file risk score shown as badges and inline annotations. Add an env-gated LLM reviewer behind the same interface with a mocked fetch in tests. Finish with README screenshot, sample report, and architecture notes.
<!-- builder:roadmap:end -->

import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDiff } from "../parser";
import type { DiffFile } from "../parser";
import { createReviewer, reviewerKind } from "./createReviewer";
import { DEFAULT_LLM_API_BASE, DEFAULT_LLM_MODEL, LlmReviewer } from "./llmReviewer";
import type { FetchLike } from "./llmReviewer";
import { OfflineReviewer } from "./offlineReviewer";
import { Severity } from "./types";

const DIFF = [
  "diff --git a/src/app.ts b/src/app.ts",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,2 +1,3 @@",
  " start",
  "-const old = 1;",
  "+const api_key = 'abc123';",
  "+console.log(api_key);",
  "",
].join("\n");

const BINARY_DIFF = [
  "diff --git a/logo.png b/logo.png",
  "index 1234567..89abcde 100644",
  "Binary files a/logo.png and b/logo.png differ",
  "",
].join("\n");

const files: DiffFile[] = parseDiff(DIFF);

/** Minimal stand-in for a `fetch` response. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A chat-completions payload carrying `content` as the model's answer. */
function completion(content: string): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

interface Harness {
  reviewer: LlmReviewer;
  fetchMock: ReturnType<typeof vi.fn>;
  warnings: string[];
}

function harness(
  options: { apiKey?: string; apiBase?: string; model?: string; fallback?: OfflineReviewer } = {},
): Harness {
  const fetchMock = vi.fn();
  const warnings: string[] = [];
  const reviewer = new LlmReviewer({
    apiKey: options.apiKey ?? "test-key",
    apiBase: options.apiBase,
    model: options.model,
    env: {},
    fetch: fetchMock as unknown as FetchLike,
    fallback: options.fallback,
    onWarning: (message) => warnings.push(message),
  });
  return { reviewer, fetchMock, warnings };
}

describe("LlmReviewer: happy path", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses findings, defaults the file path and normalises severities", async () => {
    const { reviewer, fetchMock } = harness();
    fetchMock.mockResolvedValue(
      completion(
        JSON.stringify([
          { file: "src/app.ts", line: 2, severity: "high", message: "Hard-coded API key" },
          { line: 3, severity: "MEDIUM", message: "Debug statement left in" },
          { severity: "unknown-level", message: "Unrecognised severity becomes medium" },
          { line: 4, severity: "low" },
        ]),
      ),
    );

    expect(await reviewer.review(files)).toEqual([
      {
        file: "src/app.ts",
        line: 2,
        severity: Severity.High,
        message: "Hard-coded API key",
      },
      {
        file: "src/app.ts",
        line: 3,
        severity: Severity.Medium,
        message: "Debug statement left in",
      },
      {
        file: "src/app.ts",
        line: null,
        severity: Severity.Medium,
        message: "Unrecognised severity becomes medium",
      },
    ]);
  });

  it("accepts output wrapped in a ```json fence", async () => {
    const { reviewer, fetchMock } = harness();
    fetchMock.mockResolvedValue(
      completion('```json\n[{"line": 2, "severity": "low", "message": "Nit"}]\n```'),
    );

    const findings = await reviewer.review(files);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ line: 2, severity: Severity.Low, message: "Nit" });
  });

  it("accepts an empty array as 'nothing suspicious'", async () => {
    const { reviewer, fetchMock, warnings } = harness();
    fetchMock.mockResolvedValue(completion("[]"));

    expect(await reviewer.review(files)).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("sends the key, model and a line-numbered prompt to the chat endpoint", async () => {
    const { reviewer, fetchMock } = harness({ apiBase: "https://example.test/v1/" });
    fetchMock.mockResolvedValue(completion("[]"));
    await reviewer.review(files);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe(DEFAULT_LLM_MODEL);
    expect(body.messages[0]?.role).toBe("system");
    const prompt = body.messages[1]?.content ?? "";
    expect(prompt).toContain("File: src/app.ts (modified, +2 -1)");
    expect(prompt).toContain("@@ -1,2 +1,3 @@");
    expect(prompt).toContain("2 + const api_key = 'abc123';");
    expect(prompt).toContain("2 - const old = 1;");
  });

  it("uses the public API base by default", async () => {
    const { reviewer, fetchMock } = harness();
    fetchMock.mockResolvedValue(completion("[]"));
    await reviewer.review(files);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${DEFAULT_LLM_API_BASE}/chat/completions`);
  });
});

describe("LlmReviewer: degraded paths", () => {
  it("returns no findings when the output is not JSON", async () => {
    const { reviewer, fetchMock, warnings } = harness();
    fetchMock.mockResolvedValue(completion("Looks fine to me!"));

    expect(await reviewer.review(files)).toEqual([]);
    expect(warnings[0]).toContain("src/app.ts");
    expect(reviewer.warnings).toHaveLength(1);
  });

  it("returns no findings when the JSON is not a list of findings", async () => {
    const { reviewer, fetchMock } = harness();
    fetchMock.mockResolvedValue(completion('{"verdict": "ok"}'));
    expect(await reviewer.review(files)).toEqual([]);
  });

  it("returns no findings on a non-OK status", async () => {
    const { reviewer, fetchMock, warnings } = harness();
    fetchMock.mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    expect(await reviewer.review(files)).toEqual([]);
    expect(warnings[0]).toContain("HTTP 500");
  });

  it("returns no findings when fetch rejects", async () => {
    const { reviewer, fetchMock, warnings } = harness();
    fetchMock.mockRejectedValue(new Error("network down"));

    expect(await reviewer.review(files)).toEqual([]);
    expect(warnings[0]).toContain("network down");
  });

  it("returns no findings when the response carries no message content", async () => {
    const { reviewer, fetchMock } = harness();
    fetchMock.mockResolvedValue(jsonResponse({ choices: [] }));
    expect(await reviewer.review(files)).toEqual([]);
  });

  it("falls back to the offline reviewer when one is injected", async () => {
    const { reviewer, fetchMock, warnings } = harness({ fallback: new OfflineReviewer() });
    fetchMock.mockRejectedValue(new Error("network down"));

    const findings = await reviewer.review(files);
    expect(findings.some((finding) => finding.severity === Severity.High)).toBe(true);
    expect(warnings[0]).toContain("using the offline reviewer instead");
  });

  it("never calls fetch without an API key", async () => {
    const { reviewer, fetchMock, warnings } = harness({ apiKey: "" });

    expect(await reviewer.review(files)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnings[0]).toContain("no API key configured");
  });

  it("skips binary and hunk-free files without calling fetch", async () => {
    const { reviewer, fetchMock } = harness();

    expect(await reviewer.review(parseDiff(BINARY_DIFF))).toEqual([]);
    expect(await reviewer.review([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createReviewer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the offline reviewer by default and touches no network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const reviewer = createReviewer({});
    expect(reviewer).toBeInstanceOf(OfflineReviewer);
    expect(reviewerKind({})).toBe("offline");

    const findings = await reviewer.review(files);
    expect(findings.some((finding) => finding.severity === Severity.High)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stays offline when VITE_REVIEWER=llm but no key is configured", () => {
    expect(createReviewer({ VITE_REVIEWER: "llm" })).toBeInstanceOf(OfflineReviewer);
    expect(createReviewer({ VITE_REVIEWER: "llm", VITE_LLM_API_KEY: "  " })).toBeInstanceOf(
      OfflineReviewer,
    );
    expect(reviewerKind({ VITE_REVIEWER: "llm" })).toBe("offline");
  });

  it("returns the LLM reviewer when VITE_REVIEWER=llm and a key is set", () => {
    const env = { VITE_REVIEWER: "LLM", VITE_LLM_API_KEY: "sk-test" };
    expect(createReviewer(env)).toBeInstanceOf(LlmReviewer);
    expect(reviewerKind(env)).toBe("llm");
  });

  it("ignores unknown reviewer names", () => {
    expect(
      createReviewer({ VITE_REVIEWER: "magic", VITE_LLM_API_KEY: "sk-test" }),
    ).toBeInstanceOf(OfflineReviewer);
  });
});

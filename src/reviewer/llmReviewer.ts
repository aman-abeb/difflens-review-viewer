import type { DiffFile, Line } from "../parser";
import type { Finding, Reviewer } from "./types";
import { Severity } from "./types";

/** Environment variables that select and configure the reviewer implementation. */
export interface ReviewerEnv {
  /** `"llm"` enables {@link LlmReviewer}; anything else keeps the offline reviewer. */
  readonly VITE_REVIEWER?: string;
  readonly VITE_LLM_API_KEY?: string;
  readonly VITE_LLM_API_BASE?: string;
  readonly VITE_LLM_MODEL?: string;
}

/** The slice of `fetch` used by {@link LlmReviewer}; injectable for tests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Chat-completions base URL used when `VITE_LLM_API_BASE` is unset. */
export const DEFAULT_LLM_API_BASE = "https://api.openai.com/v1";

/** Model used when `VITE_LLM_MODEL` is unset. */
export const DEFAULT_LLM_MODEL = "gpt-4o-mini";

/** Maximum number of diff lines sent per file, so prompts stay bounded. */
const DEFAULT_MAX_PROMPT_LINES = 400;

const SYSTEM_PROMPT =
  "You are a meticulous code reviewer looking at a unified diff. " +
  'Reply with a JSON array of findings shaped {"file": string, "line": number|null, ' +
  '"severity": "low"|"medium"|"high", "message": string}. ' +
  "Use the line numbers shown in the diff and reply with [] when nothing is suspicious. " +
  "Output JSON only, no prose.";

/**
 * Reads the Vite environment in a way that also works outside a Vite bundle
 * (for example under `tsx`), where `import.meta.env` is undefined.
 *
 * @returns The reviewer-related environment variables.
 */
export function readEnv(): ReviewerEnv {
  return (import.meta.env ?? {}) as unknown as ReviewerEnv;
}

/** Options of {@link LlmReviewer}; every field falls back to the environment. */
export interface LlmReviewerOptions {
  /** API key; defaults to `VITE_LLM_API_KEY`. Without one, no request is made. */
  apiKey?: string;
  /** Base URL of an OpenAI-compatible API; defaults to `VITE_LLM_API_BASE`. */
  apiBase?: string;
  /** Model name; defaults to `VITE_LLM_MODEL`. */
  model?: string;
  /** Environment used for the defaults above. */
  env?: ReviewerEnv;
  /** `fetch` implementation; defaults to the global one. */
  fetch?: FetchLike;
  /** Reviewer used when a request fails; its findings replace the LLM's. */
  fallback?: Reviewer;
  /** Called for every degraded request; defaults to `console.warn`. */
  onWarning?: (message: string) => void;
  /** Maximum diff lines per file included in the prompt. */
  maxPromptLines?: number;
}

/** Shape of the parts of a chat-completions response that we read. */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } } | undefined>;
}

/** Path used to label a file in prompts and findings. */
function displayPath(file: DiffFile): string {
  return file.newPath ?? file.oldPath ?? "(unknown file)";
}

function formatLine(line: Line): string {
  const marker = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
  const number = line.newLineNumber ?? line.oldLineNumber;
  return `${String(number ?? "").padStart(5)} ${marker} ${line.content}`;
}

/** Serialises one file's hunks into a compact, line-numbered prompt. */
function buildPrompt(file: DiffFile, maxLines: number): string {
  const path = displayPath(file);
  const parts: string[] = [`File: ${path} (${file.status}, +${file.additions} -${file.deletions})`];
  let budget = maxLines;

  for (const hunk of file.hunks) {
    if (budget <= 0) {
      break;
    }
    parts.push(hunk.header);
    const lines = hunk.lines.slice(0, budget);
    budget -= lines.length;
    parts.push(...lines.map(formatLine));
  }

  const total = file.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  if (total > maxLines) {
    parts.push(`... ${total - maxLines} more line(s) omitted`);
  }
  return parts.join("\n");
}

/** Removes a surrounding ```json fence, if the model added one. */
function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*\r?\n([\s\S]*?)\r?\n?\s*```\s*$/.exec(text);
  return fenced?.[1] ?? text;
}

function toSeverity(value: unknown): Severity {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === Severity.High || text === Severity.Low) {
    return text as Severity;
  }
  return Severity.Medium;
}

function toFinding(value: unknown, fallbackPath: string): Finding | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (message === "") {
    return null;
  }
  const file =
    typeof record.file === "string" && record.file.trim() !== "" ? record.file.trim() : fallbackPath;
  const rawLine = record.line;
  const line =
    typeof rawLine === "number" && Number.isInteger(rawLine) && rawLine > 0 ? rawLine : null;

  return { file, line, severity: toSeverity(record.severity), message };
}

/**
 * Parses model output into findings.
 *
 * @returns The findings, or `null` when the output is not a JSON array
 * (or `{ findings: [...] }` object) of findings.
 */
function parseFindings(raw: string, fallbackPath: string): Finding[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    return null;
  }

  let items: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (typeof parsed === "object" && parsed !== null) {
    const wrapped = (parsed as { findings?: unknown }).findings;
    items = Array.isArray(wrapped) ? wrapped : null;
  }
  if (items === null) {
    return null;
  }

  return items
    .map((item) => toFinding(item, fallbackPath))
    .filter((finding): finding is Finding => finding !== null);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reviewer backed by an OpenAI-compatible chat-completions API.
 *
 * One request is sent per text file that has hunks; binary and hunk-free files
 * are skipped. The reviewer never throws and never requires a key to construct:
 * on a missing key, network error, non-OK status or unparsable output it
 * records a warning and returns the fallback reviewer's findings (or `[]`).
 */
export class LlmReviewer implements Reviewer {
  /** Warnings recorded for degraded requests, oldest first. */
  readonly warnings: string[] = [];

  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;
  private readonly fallback: Reviewer | null;
  private readonly onWarning: (message: string) => void;
  private readonly maxPromptLines: number;

  constructor(options: LlmReviewerOptions = {}) {
    const env = options.env ?? readEnv();
    this.apiKey = (options.apiKey ?? env.VITE_LLM_API_KEY ?? "").trim();
    this.apiBase = (options.apiBase ?? env.VITE_LLM_API_BASE ?? DEFAULT_LLM_API_BASE).replace(
      /\/+$/,
      "",
    );
    this.model = options.model ?? env.VITE_LLM_MODEL ?? DEFAULT_LLM_MODEL;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.fallback = options.fallback ?? null;
    this.onWarning = options.onWarning ?? ((message) => console.warn(message));
    this.maxPromptLines = options.maxPromptLines ?? DEFAULT_MAX_PROMPT_LINES;
  }

  /**
   * Reviews the files of a diff through the configured model.
   *
   * @param files - Files returned by `parseDiff`.
   * @returns The findings; `[]` (or the fallback's findings) when the API is
   * unavailable or answers with something unusable.
   */
  async review(files: DiffFile[]): Promise<Finding[]> {
    const reviewable = files.filter((file) => !file.binary && file.hunks.length > 0);
    if (reviewable.length === 0) {
      return [];
    }
    if (this.apiKey === "") {
      return this.degrade(reviewable, "no API key configured");
    }

    const perFile = await Promise.all(reviewable.map((file) => this.reviewFile(file)));
    return perFile.flat();
  }

  private async reviewFile(file: DiffFile): Promise<Finding[]> {
    const path = displayPath(file);
    try {
      const response = await this.fetchImpl(`${this.apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildPrompt(file, this.maxPromptLines) },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("response contained no message content");
      }

      const findings = parseFindings(content, path);
      if (findings === null) {
        throw new Error("model output was not a JSON array of findings");
      }
      return findings;
    } catch (error) {
      return this.degrade([file], errorMessage(error));
    }
  }

  /** Records a warning and hands the files to the fallback reviewer, if any. */
  private async degrade(files: DiffFile[], reason: string): Promise<Finding[]> {
    const paths = files.map(displayPath).join(", ");
    const warning = `LLM review of ${paths} failed: ${reason}; ${
      this.fallback ? "using the offline reviewer instead" : "returning no findings"
    }`;
    this.warnings.push(warning);
    this.onWarning(warning);
    return this.fallback ? this.fallback.review(files) : [];
  }
}

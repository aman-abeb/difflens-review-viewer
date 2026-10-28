import { LlmReviewer, readEnv } from "./llmReviewer";
import type { ReviewerEnv } from "./llmReviewer";
import { OfflineReviewer } from "./offlineReviewer";
import type { Reviewer } from "./types";

/** Which {@link Reviewer} implementation is active. */
export type ReviewerKind = "offline" | "llm";

/**
 * Decides which reviewer the environment asks for.
 *
 * The LLM reviewer is only selected when `VITE_REVIEWER=llm` *and* an API key
 * is present, so a half-configured environment still works offline.
 *
 * @param env - Environment to inspect; defaults to `import.meta.env`.
 * @returns `"llm"` or `"offline"`.
 */
export function reviewerKind(env: ReviewerEnv = readEnv()): ReviewerKind {
  const requested = env.VITE_REVIEWER?.trim().toLowerCase();
  const hasKey = (env.VITE_LLM_API_KEY ?? "").trim() !== "";
  return requested === "llm" && hasKey ? "llm" : "offline";
}

/**
 * Builds the reviewer for the current environment.
 *
 * Defaults to the fully offline {@link OfflineReviewer}; with
 * `VITE_REVIEWER=llm` and `VITE_LLM_API_KEY` set it returns an
 * {@link LlmReviewer} that falls back to the offline rules whenever a request
 * fails, so the UI always gets findings.
 *
 * @param env - Environment to read; defaults to `import.meta.env`.
 * @returns A reviewer that never requires the network to be reachable.
 */
export function createReviewer(env: ReviewerEnv = readEnv()): Reviewer {
  const offline = new OfflineReviewer();
  if (reviewerKind(env) === "offline") {
    return offline;
  }
  return new LlmReviewer({ env, fallback: offline });
}

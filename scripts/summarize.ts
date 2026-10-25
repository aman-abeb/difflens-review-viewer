import { formatSummary } from "../src/cli/summarize";
import { parseDiff } from "../src/parser/parseDiff";

const USAGE = "Usage: git diff | npm run summarize --silent";

async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) {
    text += String(chunk);
  }
  return text;
}

async function main(): Promise<number> {
  if (process.stdin.isTTY) {
    console.error(`No diff on stdin.\n${USAGE}`);
    return 1;
  }

  const files = parseDiff(await readStdin());
  if (files.length === 0) {
    console.error(`No files found in input: expected a unified diff on stdin.\n${USAGE}`);
    return 1;
  }

  console.log(formatSummary(files));
  return 0;
}

process.exitCode = await main();

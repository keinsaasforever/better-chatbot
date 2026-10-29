/**
 * Verifies that Anthropic prompt caching actually survives the AI Gateway.
 *
 * The cost work in this repo assumes `providerOptions.anthropic.cacheControl`
 * reaches Anthropic through `@ai-sdk/gateway`. That could not be confirmed in
 * CI (no gateway credentials), so run this once in an environment that has
 * them. Everything else degrades gracefully if it turns out to be false - the
 * breakpoints simply become inert - but the savings depend on it.
 *
 *   pnpm --filter web tsx scripts/verify-prompt-cache.ts
 *
 * PASS  second call reports cacheReadTokens > 0
 * FAIL  no cache read - see the notes printed at the end
 */
import { generateText } from "ai";
import { ANTHROPIC_CACHE_CONTROL } from "../src/lib/ai/prompt-cache";
import "../src/lib/ai/register-gateway-provider";

const MODEL = process.env.VERIFY_CACHE_MODEL ?? "anthropic/claude-sonnet-5";

// Must exceed the model's minimum cacheable prefix (1024 tokens for Sonnet 5 /
// Opus 4.8, 4096 for Haiku 4.5). Below it, caching silently does nothing.
const FILLER = `
You are a meticulous assistant participating in a prompt-cache verification run.
Restate nothing. Follow instructions exactly and answer in a single short word.
`.repeat(120);

const call = async (question: string) =>
  generateText({
    model: MODEL as any,
    system: {
      role: "system",
      content: FILLER,
      providerOptions: ANTHROPIC_CACHE_CONTROL,
    },
    prompt: question,
  });

async function main() {
  console.log(`model: ${MODEL}`);

  const first = await call("Reply with the word: alpha");
  const second = await call("Reply with the word: beta");

  const detail = (r: Awaited<ReturnType<typeof call>>) => ({
    input: r.usage.inputTokens,
    cacheRead: r.usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWrite: r.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
  });

  const a = detail(first);
  const b = detail(second);
  console.table({ "call 1 (writes cache)": a, "call 2 (should read)": b });

  if (b.cacheRead > 0) {
    console.log(`\nPASS - ${b.cacheRead} tokens read from cache on call 2.`);
    console.log("Gateway forwards providerOptions. Breakpoints are effective.");
    return;
  }

  console.log("\nFAIL - no cache read on the second call.");
  console.log("Check, in order:");
  console.log(
    "  1. Is the prefix above the model's minimum? (1024 / 4096 tokens)",
  );
  console.log("  2. Does this @ai-sdk/gateway build forward providerOptions?");
  console.log("  3. Did more than 5 minutes elapse between the two calls?");
  console.log(
    "If the gateway is the culprit, the fallback is routing Anthropic models\n" +
      "through @ai-sdk/anthropic directly - which gives up gateway failover for\n" +
      "those models, so it is a decision to make deliberately.",
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

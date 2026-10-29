/**
 * Weighs input tokens by what each kind actually costs.
 *
 * Prompt caching splits the input side of a request into three parts that are
 * priced very differently: tokens read back from the cache cost roughly a tenth
 * of a normal input token, tokens written into it cost a premium, and the rest
 * cost full price. Billing all three as plain input tokens - which is what this
 * app did - charges a customer full price for a discount the provider already
 * gave us, and hides the effect of every caching improvement.
 *
 * Deliberately pure and free of `server-only` and of any billing provider: it
 * is shared by usage billing and by the member budget in `lib/ai/routing`, and
 * billing is reachable from client components through the tool modules, so
 * nothing on this path may pull in a server-only module.
 */

/** Token counts as the AI SDK reports them in `usage`. */
export type InputTokenCounts = {
  /** `usage.inputTokens` - the total, cached parts included. */
  promptTokens: number;
  /** `usage.inputTokenDetails.cacheReadTokens` */
  cacheReadTokens?: number;
  /** `usage.inputTokenDetails.cacheWriteTokens` */
  cacheWriteTokens?: number;
  /** `usage.inputTokenDetails.noCacheTokens` */
  noCacheTokens?: number;
};

/** Cache prices as a multiple of the model's normal input price. */
export type CacheRatios = {
  readRatio: number;
  writeRatio: number;
};

export type WeightedInputTokens = {
  noCacheTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /**
   * What the input side is worth in normal-input-token terms. Equal to
   * `promptTokens` whenever no cache activity was reported, so a provider that
   * sends no detail bills exactly as it did before.
   */
  effectiveInputTokens: number;
};

const nonNegative = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

export function weightInputTokens(
  counts: InputTokenCounts,
  ratios: CacheRatios,
): WeightedInputTokens {
  const promptTokens = nonNegative(counts.promptTokens);
  const cacheReadTokens = nonNegative(counts.cacheReadTokens);
  const cacheWriteTokens = nonNegative(counts.cacheWriteTokens);

  // No cache activity reported - either the provider does not cache, or this
  // SDK version does not break the number down. Either way the answer has to be
  // byte-identical to the old one, so return early rather than let a ratio
  // multiply anything.
  if (cacheReadTokens === 0 && cacheWriteTokens === 0) {
    return {
      noCacheTokens: promptTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveInputTokens: promptTokens,
    };
  }

  // `noCacheTokens` is reported directly by the SDK; derive it when it is not,
  // and never let a mismatched trio push the remainder below zero.
  const noCacheTokens =
    counts.noCacheTokens != null
      ? nonNegative(counts.noCacheTokens)
      : Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);

  const effectiveInputTokens =
    noCacheTokens +
    cacheWriteTokens * ratios.writeRatio +
    cacheReadTokens * ratios.readRatio;

  return {
    noCacheTokens,
    cacheReadTokens,
    cacheWriteTokens,
    effectiveInputTokens,
  };
}

/**
 * Prompt-cache pricing, as a multiple of a model's normal input price.
 *
 * Applied by `trackCostBasedTokens()` so that a cached prompt costs the
 * customer what it costs us. Reading a cached prefix is roughly a tenth of a
 * normal input token across every provider that supports it; writing one
 * carries a premium at Anthropic and is free at several others, so the write
 * default is the conservative (Anthropic-shaped) figure.
 *
 * These are deliberately two constants rather than ~60 hand-maintained table
 * entries. The Gateway publishes real per-model cache prices via
 * `getAvailableModels()` (`pricing.cachedInputTokens` and
 * `pricing.cacheCreationInputTokens`, USD per token); materialising those into
 * `cacheReadRatio` / `cacheWriteRatio` is the follow-up. It is not done on the
 * billing path itself: the billing client must stay free of `server-only`,
 * and a price fetch there would put a network call and a failure mode on every
 * metered request.
 */
export const DEFAULT_CACHE_READ_RATIO = 0.1;
export const DEFAULT_CACHE_WRITE_RATIO = 1.25;

/** The cache ratios in force for a model, defaults included. */
export const resolveCacheRatios = (model?: {
  cacheReadRatio?: number;
  cacheWriteRatio?: number;
}) => ({
  readRatio: model?.cacheReadRatio ?? DEFAULT_CACHE_READ_RATIO,
  writeRatio: model?.cacheWriteRatio ?? DEFAULT_CACHE_WRITE_RATIO,
});

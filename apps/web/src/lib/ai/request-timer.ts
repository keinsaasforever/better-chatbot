import "server-only";
import { SpanStatusCode, metrics, trace } from "@opentelemetry/api";
import globalLogger from "logger";
import { colorize } from "consola/utils";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `LatencyTimer: `),
});

// Meter and instruments are created once per module, not per request — creating
// them in the hot path allocates on every chat message for no benefit.
const meter = metrics.getMeter("keinsaas-navigator.chat");
const tracer = trace.getTracer("keinsaas-navigator.chat");

const ttftHistogram = meter.createHistogram("chat.ttft", {
  description: "Time to first token, from request start.",
  unit: "ms",
});
const totalHistogram = meter.createHistogram("chat.total", {
  description: "Total chat request duration.",
  unit: "ms",
});
const gatewayTtftHistogram = meter.createHistogram("chat.gateway.ttft", {
  description:
    "Time to first token measured from the model call — gateway + provider latency, excluding server-side work.",
  unit: "ms",
});
const stageHistogram = meter.createHistogram("chat.stage.duration", {
  description:
    "Duration of an individual blocking stage before the model call.",
  unit: "ms",
});

/**
 * Lightweight per-request latency timer for the chat/LLM request path.
 *
 * Goal: pinpoint where time-to-first-token (TTFT) is spent. Every blocking
 * stage that runs *before* the model starts streaming (MCP tool loading,
 * Composio, RAG retrieval, billing lookups, etc.) is recorded individually,
 * plus the TTFT and the total request duration.
 *
 * Each stage becomes a child span, the totals land on the active request span
 * and on histograms, and the whole thing is *also* still emitted as a single
 * structured JSON log line — which now carries `trace_id`/`span_id` via the
 * consola→OTel bridge, so the existing Vercel-logs workflow keeps working and
 * cross-links into the trace.
 *
 * Designed to be effectively free: just `performance.now()` deltas and a small
 * object. Safe to call from many concurrent requests — each request owns its
 * own timer instance (no shared/global state).
 */
export type RequestTimer = {
  /** Wrap an async (or sync) stage and record its wall-clock duration in ms. */
  track<T>(stage: string, fn: () => Promise<T> | T): Promise<T>;
  /** Manually record a duration (ms) for a stage. */
  mark(stage: string, ms: number): void;
  /**
   * Snapshot the elapsed time at the moment just before the model is called.
   * Everything up to here is server-side work (auth, DB, tool loading, prompt
   * assembly). `ttftMs - beforeModelMs` then isolates pure gateway + provider
   * latency. Idempotent — first call wins.
   */
  beforeModel(): void;
  /** Record time-to-first-token relative to timer creation. Idempotent. */
  firstToken(): void;
  /** Total elapsed ms since timer creation. */
  elapsed(): number;
  /** Emit a single structured summary log line. Call once per request. */
  flush(extra?: Record<string, unknown>): void;
};

export function createRequestTimer(label: string): RequestTimer {
  const startedAt = performance.now();
  const stages: Record<string, number> = {};
  let firstTokenAt: number | undefined;
  let beforeModelAt: number | undefined;
  let flushed = false;

  const recordStage = (stage: string, ms: number) => {
    stages[stage] = Math.round(ms);
    // `label` and `stage` are both code-defined constants, so this stays
    // low-cardinality — safe as metric dimensions.
    stageHistogram.record(stages[stage], { label, stage });
  };

  return {
    async track(stage, fn) {
      const start = performance.now();
      // A child span per stage turns the pre-stream breakdown into a flame
      // graph instead of a flat list of numbers.
      return await tracer.startActiveSpan(
        `chat.stage.${stage}`,
        async (span) => {
          try {
            return await fn();
          } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            recordStage(stage, performance.now() - start);
            span.end();
          }
        },
      );
    },
    mark(stage, ms) {
      recordStage(stage, ms);
    },
    beforeModel() {
      if (beforeModelAt === undefined) {
        beforeModelAt = Math.round(performance.now() - startedAt);
      }
    },
    firstToken() {
      if (firstTokenAt === undefined) {
        firstTokenAt = Math.round(performance.now() - startedAt);
      }
    },
    elapsed() {
      return Math.round(performance.now() - startedAt);
    },
    flush(extra) {
      if (flushed) return;
      flushed = true;
      const total = Math.round(performance.now() - startedAt);
      // Sum of pre-stream stages — i.e. blocking work in front of the model.
      const preStreamMs = Object.values(stages).reduce((a, b) => a + b, 0);
      // Pure gateway + provider time-to-first-token, once all server-side work
      // (measured + unmeasured) is excluded.
      const gatewayTtftMs =
        firstTokenAt !== undefined && beforeModelAt !== undefined
          ? firstTokenAt - beforeModelAt
          : null;

      totalHistogram.record(total, { label });
      if (firstTokenAt !== undefined) {
        ttftHistogram.record(firstTokenAt, { label });
      }
      if (gatewayTtftMs !== null) {
        gatewayTtftHistogram.record(gatewayTtftMs, { label });
      }

      // Hang the summary off the request span so a slow trace explains itself
      // without a join against metrics.
      const activeSpan = trace.getActiveSpan();
      if (activeSpan) {
        activeSpan.setAttributes({
          "app.chat.total_ms": total,
          "app.chat.pre_stream_ms": preStreamMs,
          ...(firstTokenAt !== undefined
            ? { "app.chat.ttft_ms": firstTokenAt }
            : {}),
          ...(beforeModelAt !== undefined
            ? { "app.chat.before_model_ms": beforeModelAt }
            : {}),
          ...(gatewayTtftMs !== null
            ? { "app.gateway.ttft_ms": gatewayTtftMs }
            : {}),
        });
      }

      logger.info(
        JSON.stringify({
          label,
          ttftMs: firstTokenAt ?? null,
          beforeModelMs: beforeModelAt ?? null,
          gatewayTtftMs,
          totalMs: total,
          preStreamMs,
          stages,
          ...extra,
        }),
      );
    },
  };
}

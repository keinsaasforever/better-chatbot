import { metrics, trace } from "@opentelemetry/api";

/**
 * Shared meters, tracers and instruments for the app's business operations.
 *
 * Instruments are created once at module scope. Every dimension used here is a
 * code-defined constant or an opaque enum-like value (outcome, channel, error
 * class) — never a user ID, org ID, or free-text string, which would blow up
 * metric cardinality. Those belong on spans, not on metric attributes.
 */
const meter = metrics.getMeter("keinsaas-navigator");

export const appTracer = trace.getTracer("keinsaas-navigator");

/** MCP tool calls by outcome — the per-server failure rate. */
export const mcpToolCalls = meter.createCounter("mcp.tool.calls", {
  description: "MCP tool call attempts, by outcome.",
});

export const mcpToolCallDuration = meter.createHistogram(
  "mcp.tool.call.duration",
  { description: "MCP tool call duration.", unit: "ms" },
);

/** MCP tool-list lookups, split by whether the versioned cache served them. */
export const mcpToolListLookups = meter.createCounter(
  "mcp.tools.list.lookups",
  {
    description: "MCP tool list lookups, by cache result and outcome.",
  },
);

/** Model routing decisions — which model was picked, and by what. */
export const aiRouteDecisions = meter.createCounter("ai.route.decisions", {
  description:
    "Model routing decisions, by resolved model and decision source.",
});

/**
 * Billing usage tracking outcomes.
 *
 * Usage events use deterministic idempotency keys, so a spike in `duplicate`
 * is normal (retries) but a spike in `failed` means usage is being dropped —
 * i.e. silently under-billing. Both are invisible today.
 */
export const billingUsageEvents = meter.createCounter("billing.usage.events", {
  description: "Billing usage tracking attempts, by outcome.",
});

/** Background job runs by outcome — async failures have no other signal. */
export const jobRuns = meter.createCounter("job.runs", {
  description: "Background (Inngest) function runs, by function and outcome.",
});

/** Inbound webhook deliveries, including signature-verification rejections. */
export const webhookDeliveries = meter.createCounter("webhook.deliveries", {
  description: "Inbound webhook deliveries, by source and outcome.",
});

/**
 * E2B sandbox running time, from the lifecycle webhook.
 *
 * E2B bills per second of running time, so this is the cost signal. Before
 * this existed the only way to answer "what does a preview actually cost us"
 * was the E2B dashboard, which cannot be split by template or correlated with
 * a deploy. Attributed by template and event type only — never sandbox ID,
 * which would be unbounded cardinality.
 */
export const e2bSandboxRuntime = meter.createHistogram("e2b.sandbox.runtime", {
  description: "E2B sandbox running time per execution interval.",
  unit: "ms",
});

/**
 * vCPU-seconds per interval — the term that dominates the E2B bill, and the
 * one that actually moves when sandboxes are paused earlier.
 */
export const e2bSandboxVcpuSeconds = meter.createHistogram(
  "e2b.sandbox.vcpu_seconds",
  { description: "E2B vCPU-seconds consumed per execution interval." },
);

/**
 * Navigator tool runs (`lib/navigator-tools`), from voice and MCP alike. Tool
 * names are code-defined constants, so they are safe as a dimension.
 */
export const navigatorToolDuration = meter.createHistogram(
  "navigator.tool.duration",
  {
    description: "Navigator tool run duration, by tool, caller and outcome.",
    unit: "ms",
  },
);

/**
 * Voice tool calls end to end on the server, by executor kind. The tool name
 * is only recorded for app tools: MCP and Composio names are user-defined.
 */
export const voiceToolDuration = meter.createHistogram("voice.tool.duration", {
  description: "Voice tool call duration (voice.tool_ms), by kind and outcome.",
  unit: "ms",
});

/**
 * Cockpit provider runs (probe on save/test, feed refresh), by provider,
 * operation and outcome. All three are code-defined enums; the outcome is
 * `ok` or a reason code from `lib/cockpit/reasons.ts`, whose detail (an HTTP
 * status, a tool name) stays on the `cockpit.provider.*` span.
 */
export const cockpitProviderRuns = meter.createCounter(
  "cockpit.provider.runs",
  {
    description:
      "Cockpit provider probes and feed refreshes, by provider, operation and outcome.",
  },
);

import { IS_VERCEL_ENV } from "lib/const";

type OptionalFeature = {
  /** Env vars that must all be present for the feature to be active. */
  vars: string[];
  /** Alternative: the feature is active when any one of these is present. */
  anyOf?: string[];
  /** What the vars unlock. */
  feature: string;
  /** What happens when they are missing. */
  fallback: string;
};

const has = (name: string) => Boolean(process.env[name]?.trim());

/**
 * Every provider path that can serve a model. The gateway is the documented
 * default, but a self-hoster running only Ollama, TensorX or Groq is a valid
 * setup, so the boot check fails only when none of them is configured.
 */
const MODEL_PROVIDER_VARS = [
  "AI_GATEWAY_API_KEY",
  "TENSORX_API_KEY",
  "GROQ_API_KEY",
  "OLLAMA_BASE_URL",
  "OPENAI_COMPATIBLE_DATA",
];

const OPTIONAL_FEATURES: OptionalFeature[] = [
  {
    vars: [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ],
    feature: "File uploads, avatars and AI-generated images (Supabase Storage)",
    fallback: "uploads are disabled",
  },
  {
    vars: ["AGENTSET_API_KEY"],
    feature: "Knowledge bases (hosted RAG)",
    fallback:
      "knowledge bases are unavailable; project RAG falls back to local pgvector search",
  },
  {
    // KV_URL is what the Vercel/Upstash integration provisions; the stream
    // context accepts either name.
    vars: ["REDIS_URL"],
    anyOf: ["REDIS_URL", "KV_URL"],
    feature: "Resumable chat streams and cross-instance stop",
    fallback:
      "streams are viewer-bound (a closed tab or reload cancels the run) and the cache is per-instance",
  },
  {
    vars: ["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY"],
    feature: "Background jobs (scheduled tasks, project brain)",
    fallback:
      "scheduled tasks and the sandbox reaper must be driven by HTTP cron using SCHEDULED_TASK_SECRET",
  },
  {
    vars: ["E2B_API_KEY"],
    feature: "Sandboxed code execution",
    fallback: "code runs in the in-browser worker only",
  },
  {
    vars: ["EXA_API_KEY"],
    feature: "Web search tool",
    fallback: "web search is unavailable",
  },
  {
    vars: ["ASSEMBLYAI_API_KEY"],
    feature: "Voice transcription",
    fallback: "voice transcription is unavailable",
  },
  {
    vars: ["COMPOSIO_API_KEY"],
    feature: "Connected apps (Composio: Gmail, Slack, GitHub, …)",
    fallback: "third-party app connections are unavailable",
  },
  {
    // Without its own key, production derives one from BETTER_AUTH_SECRET.
    vars: ["APP_SECRETS_KEY"],
    anyOf: ["APP_SECRETS_KEY", "BETTER_AUTH_SECRET"],
    feature:
      "Cockpit connections (encrypted credentials for Stripe, Revolut, Superlog, SEO, Vercel, website analytics)",
    fallback:
      "cockpit connections disabled: they cannot be saved or read in production (development uses a fixed, insecure key)",
  },
  {
    vars: ["VAPID_PRIVATE_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY"],
    feature: "Web push notifications",
    fallback: "browser notifications are disabled while the app is closed",
  },
  {
    vars: ["SUPERLOG_PUBLIC_TOKEN"],
    feature: "Observability (Superlog / OpenTelemetry)",
    fallback: "traces and logs stay local",
  },
];

/**
 * Validates configuration once at boot: hard-fails on the handful of variables
 * without which nothing works, and reports every optional integration that is
 * switched off so a self-hoster can see why a feature is missing.
 */
export function validateEnvironment(): void {
  const errors: string[] = [];

  // DATABASE_URL is the name the Neon integration on Vercel provisions.
  if (!has("POSTGRES_URL") && !has("DATABASE_URL")) {
    errors.push(
      "POSTGRES_URL is not set. Point it at a Postgres database with the pgvector extension (pnpm docker:pg starts one locally).",
    );
  }
  if (!has("BETTER_AUTH_SECRET")) {
    errors.push(
      "BETTER_AUTH_SECRET is not set. Generate one with: npx @better-auth/cli@latest secret",
    );
  }
  // On Vercel the AI Gateway authenticates with the deployment's OIDC token,
  // so the gateway is available without a key.
  if (!IS_VERCEL_ENV && !MODEL_PROVIDER_VARS.some(has)) {
    errors.push(
      `No model provider is configured. Set AI_GATEWAY_API_KEY (one key serves every model in the catalog), or configure one of: ${MODEL_PROVIDER_VARS.slice(1).join(", ")}.`,
    );
  }

  if (errors.length > 0) {
    console.error("❌ Configuration error — the app cannot start:");
    for (const error of errors) console.error(`   • ${error}`);
    console.error(
      "   See docs/self-hosting.md for the full environment matrix.",
    );

    // On Vercel the process is the deployment: crashing turns a misconfigured
    // env var into a hard outage, so surface it loudly and let the app boot.
    if (!IS_VERCEL_ENV) process.exit(1);
    return;
  }

  const disabled = OPTIONAL_FEATURES.filter((entry) =>
    entry.anyOf ? !entry.anyOf.some(has) : !entry.vars.every(has),
  );
  if (disabled.length > 0) {
    console.info("ℹ️ Optional integrations not configured:");
    for (const { vars, feature, fallback } of disabled) {
      console.info(`   • ${feature} — ${fallback} (set ${vars.join(", ")})`);
    }
  }
}

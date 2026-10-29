import { IS_VERCEL_ENV } from "lib/const";
import { registerObservability } from "./lib/observability/register";

export async function register() {
  // OpenTelemetry must be registered before the Vercel/CI guard below —
  // everything after it is skipped in production, so registering there would
  // mean no telemetry from the only environment we actually need it from.
  registerObservability();

  // Configuration is checked before the guard below: a missing required var is
  // just as fatal on Vercel as it is on a self-hosted box.
  const { validateEnvironment } = await import("./lib/env-validation");
  validateEnvironment();

  // Skip all database operations during Vercel build
  if (process.env.VERCEL === "1" || process.env.CI === "1") {
    console.log("⚠️ Skipping instrumentation in Vercel/CI environment");
    return;
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!IS_VERCEL_ENV) {
      if (process.env.SKIP_DB_MIGRATE !== "1") {
        // run DB migration
        const runMigrate = await import("./lib/db/pg/migrate.pg").then(
          (m) => m.runMigrate,
        );
        await runMigrate().catch((e) => {
          console.error("❌ Database migration failed:", e);
          console.error(
            "   Make sure PostgreSQL is running and POSTGRES_URL is set",
          );
          console.error(
            "   For a fresh local DB, try: pnpm db:push then SKIP_DB_MIGRATE=1 pnpm dev",
          );
          process.exit(1);
        });
      } else {
        console.log("⚠️ Skipping DB migrations (SKIP_DB_MIGRATE=1)");
      }

      const initMCPManager = await import("./lib/ai/mcp/mcp-manager").then(
        (m) => m.initMCPManager,
      );
      await initMCPManager();
    }
  }
}

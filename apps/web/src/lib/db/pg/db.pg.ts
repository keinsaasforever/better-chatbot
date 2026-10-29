import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.pg";

declare global {
  // eslint-disable-next-line no-var
  var _pgClient: postgres.Sql | undefined;
}

// Reuse one client per warm serverless instance. Supabase's transaction pooler
// is shared across every concurrent instance — keep max low (default 1) so
// instance count × max stays within the pooler limit. Override via env if needed.
// DATABASE_URL is the name the Neon integration on Vercel provisions.
export const pgClient =
  globalThis._pgClient ??
  postgres((process.env.POSTGRES_URL || process.env.DATABASE_URL)!, {
    prepare: false,
    max: process.env.POSTGRES_POOL_MAX
      ? Number(process.env.POSTGRES_POOL_MAX)
      : 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // postgres.js prints every server notice as a full object. Migrations
    // raise dozens of harmless NOTICEs (identifier truncation, "already
    // exists, skipping"); keep warnings, as one line each.
    onnotice: (notice) => {
      if (notice.severity === "NOTICE") return;
      console.warn(`[postgres] ${notice.severity}: ${notice.message}`);
    },
  });

globalThis._pgClient = pgClient;

export const pgDb = drizzle(pgClient, { schema });

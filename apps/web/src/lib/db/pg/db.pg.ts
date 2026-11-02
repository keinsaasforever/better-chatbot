import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.pg";

/**
 * The connection string, minus hints meant for a pooler rather than for
 * Postgres. postgres.js forwards every unknown query parameter to the server
 * as a runtime setting, so the `supa=base-pooler.x` that Supabase's Vercel
 * integration appends (or a `pgbouncer=true`) would be rejected as an
 * unrecognized configuration parameter.
 */
export function resolveConnectionString(
  raw = process.env.POSTGRES_URL || process.env.DATABASE_URL,
): string | undefined {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.delete("supa");
    url.searchParams.delete("pgbouncer");
    return url.toString();
  } catch {
    return raw;
  }
}

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
  postgres(resolveConnectionString()!, {
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

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { existsSync } from "node:fs";
import { join } from "path";
import { pgDb } from "lib/db/pg/db.pg";

// The migrations folder lives in apps/web. Depending on the entry point the
// process cwd is either apps/web (Next boot, package scripts) or the monorepo
// root (root `pnpm db:migrate`, CI e2e job) — support both.
const resolveMigrationsFolder = () => {
  const fromAppCwd = join(process.cwd(), "src/lib/db/migrations/pg");
  if (existsSync(fromAppCwd)) return fromAppCwd;
  return join(process.cwd(), "apps/web/src/lib/db/migrations/pg");
};

export const runMigrate = async () => {
  console.log("⏳ Running PostgreSQL migrations...");

  const start = Date.now();
  await migrate(pgDb, {
    migrationsFolder: resolveMigrationsFolder(),
  }).catch((err) => {
    console.error(
      `❌ PostgreSQL migrations failed. check the postgres instance is running.`,
      err.cause,
    );
    throw err;
  });
  const end = Date.now();

  console.log("✅ PostgreSQL migrations completed in", end - start, "ms");
};

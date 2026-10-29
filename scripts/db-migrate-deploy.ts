import "load-env";

/**
 * Applies migrations during a Vercel build, so a deployment never boots
 * against an empty or outdated database. Boot itself skips migrations on
 * Vercel (`instrumentation.ts`), which makes the build the one place they run.
 *
 * Fails the build rather than shipping an app whose schema does not match.
 */
// DATABASE_URL is the name the Neon integration provisions.
if (!process.env.POSTGRES_URL?.trim() && !process.env.DATABASE_URL?.trim()) {
  console.error(
    "❌ No database configured. Connect a Postgres database with pgvector to the project (the Neon integration sets DATABASE_URL for you), or set POSTGRES_URL, and redeploy.",
  );
  process.exit(1);
}

const { runMigrate } = await import("lib/db/pg/migrate.pg");

await runMigrate()
  .then(() => process.exit(0))
  .catch(() => {
    console.error(
      "❌ Database migrations failed (details above). Check that the database is reachable from the build and that the database offers the pgvector extension.",
    );
    process.exit(1);
  });

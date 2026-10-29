import { colorize } from "consola/utils";
import "load-env";

// Skip migrations in Vercel build environment
if (process.env.VERCEL && process.env.VERCEL_ENV) {
  console.info(
    colorize(
      "yellow",
      "⚠️  Skipping database migrations in Vercel build environment",
    ),
  );
  console.info("Run migrations manually in Supabase dashboard");
  process.exit(0);
}

// Only run migrations in local development or when explicitly needed
const { runMigrate } = await import("lib/db/pg/migrate.pg");

await runMigrate()
  .then(() => {
    console.info("🚀 DB Migration completed");
  })
  .catch((err) => {
    console.error(err);

    console.warn(
      `
      ${colorize("red", "🚨 Migration failed due to incompatible schema.")}
      
❗️DB Migration failed – incompatible schema detected.

This version introduces a complete rework of the database schema.
As a result, your existing database structure may no longer be compatible.

**To resolve this:**

1. Drop all existing tables in your database.
2. Then run the following command to apply the latest schema:


${colorize("green", "pnpm db:migrate")}

**Note:** This schema overhaul lays the foundation for more stable updates moving forward.
You shouldn't have to do this kind of reset again in future releases.

Need help? Open an issue on GitHub 🙏
      `.trim(),
    );

    process.exit(1);
  });

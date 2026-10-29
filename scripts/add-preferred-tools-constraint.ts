import "load-env";
import { pgDb } from "lib/db/pg/db.pg";
import { sql } from "drizzle-orm";

await pgDb.execute(
  sql`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'nav_pref_tools_unique'
    ) THEN
      ALTER TABLE navigator_preferred_tools
        ADD CONSTRAINT nav_pref_tools_unique UNIQUE (category, tool_name);
    END IF;
  END $$`,
);
console.log("✅ Unique constraint added to navigator_preferred_tools");
process.exit(0);

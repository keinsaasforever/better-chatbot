/**
 * Upgrade a better-chatbot 1.x database to 2.x.
 *
 *   pnpm tsx scripts/upgrade/from-better-chatbot-1.ts --dry-run
 *   pnpm tsx scripts/upgrade/from-better-chatbot-1.ts --yes
 *
 * 1.x and 2.x share the first fifteen migrations, so this is a continuation
 * rather than a rewrite: your users, chats, agents, MCP servers and workflows
 * are carried forward. Archives become projects, and the threads inside them
 * stay linked.
 *
 * The run is one way. Take a backup first:
 *
 *   pg_dump "$POSTGRES_URL" > better-chatbot-backup.sql
 */
import "load-env";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "../../apps/web/src/lib/db/migrations/pg");

/** The 1.x-only migration. 2.x continues from 0014 instead. */
const LEGACY_TAIL = "0015_yummy_wallflower";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const confirmed = args.includes("--yes");

if (!dryRun && !confirmed) {
  console.error(
    [
      "",
      "This rewrites your database and cannot be undone.",
      "",
      '  1. Back up first:  pg_dump "$POSTGRES_URL" > better-chatbot-backup.sql',
      "  2. Preview:        pnpm tsx scripts/upgrade/from-better-chatbot-1.ts --dry-run",
      "  3. Run it:         pnpm tsx scripts/upgrade/from-better-chatbot-1.ts --yes",
      "",
    ].join("\n"),
  );
  process.exit(2);
}

const url = process.env.POSTGRES_URL;
if (!url) {
  console.error("POSTGRES_URL is not set.");
  process.exit(2);
}

const sql = postgres(url, { max: 1 });
const step = (message: string) => console.log(`\n▸ ${message}`);
const note = (message: string) => console.log(`  ${message}`);

async function tableExists(name: string): Promise<boolean> {
  const [row] = await sql<{ present: boolean }[]>`
    SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS present
  `;
  return row.present;
}

async function count(table: string): Promise<number> {
  const [row] = await sql.unsafe<{ n: string }[]>(
    `SELECT count(*)::text AS n FROM "${table}"`,
  );
  return Number(row.n);
}

try {
  // ── 1. Is this the database we think it is? ──────────────────────────────
  step("Checking the database");

  if (!(await tableExists("user"))) {
    console.error(
      '  No "user" table. This does not look like a better-chatbot database.',
    );
    process.exit(1);
  }

  if (await tableExists("organization")) {
    console.error(
      [
        "  This database already has the 2.x workspace tables.",
        "  Nothing to bridge — run `pnpm db:migrate` for any pending migrations.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const ledger = await sql<{ hash: string }[]>`
    SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at
  `.catch(() => []);
  if (ledger.length === 0) {
    console.error(
      "  No migration ledger. Apply 1.x migrations before upgrading, or start fresh with `pnpm db:migrate`.",
    );
    process.exit(1);
  }
  note(`${ledger.length} migrations applied`);

  // ── 2. Will the rest of the run succeed? ─────────────────────────────────
  step("Preflight");

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    note("pgvector available");
  } catch {
    console.error(
      [
        "  This database cannot enable pgvector, which 2.x requires for document search.",
        "  Use an image or plan that provides it (pgvector/pgvector:pg17, Supabase, Neon, RDS).",
      ].join("\n"),
    );
    process.exit(1);
  }

  const before = {
    users: await count("user"),
    threads: await count("chat_thread"),
    messages: await count("chat_message"),
    archives: (await tableExists("archive")) ? await count("archive") : 0,
  };
  note(
    `${before.users} users, ${before.threads} threads, ${before.messages} messages, ${before.archives} archives`,
  );

  if (dryRun) {
    console.log(
      [
        "",
        "Dry run — nothing was changed. The upgrade would:",
        `  • carry forward ${before.users} users and ${before.threads} threads`,
        `  • give every user a personal workspace`,
        `  • convert ${before.archives} archives into projects, keeping their threads`,
        "  • apply 33 migrations and seed the model catalog",
        "",
      ].join("\n"),
    );
    process.exit(0);
  }

  // ── 3. Reconcile the ledger with the 2.x history ─────────────────────────
  step("Reconciling the migration ledger");

  const legacySql = (() => {
    try {
      return readFileSync(join(MIGRATIONS, `${LEGACY_TAIL}.sql`), "utf8");
    } catch {
      return null;
    }
  })();
  if (legacySql === null) {
    // Expected: 2.x does not ship the 1.x-only migration. Its ledger row is
    // matched by position rather than by hash.
    const removed = await sql`
      DELETE FROM drizzle.__drizzle_migrations
      WHERE created_at = (
        SELECT max(created_at) FROM drizzle.__drizzle_migrations
      )
      AND (SELECT count(*) FROM drizzle.__drizzle_migrations) = 16
      RETURNING hash
    `;
    note(
      removed.length > 0
        ? `dropped the ${LEGACY_TAIL} ledger row`
        : "ledger already matches the 2.x history",
    );
  }

  // Cached MCP tool metadata, rebuilt on the next connection.
  await sql`
    ALTER TABLE "mcp_server"
      DROP COLUMN IF EXISTS "tool_info",
      DROP COLUMN IF EXISTS "tool_info_updated_at",
      DROP COLUMN IF EXISTS "last_connection_status"
  `;
  note("removed superseded mcp_server columns");

  // ── 4. Workspace tables, before anything needs them ──────────────────────
  step("Creating the workspace tables");

  const baseline = readFileSync(
    join(MIGRATIONS, "0015_org_auth_baseline.sql"),
    "utf8",
  );
  for (const statement of baseline.split("--> statement-breakpoint")) {
    if (statement.trim()) await sql.unsafe(statement);
  }
  note("applied");

  // ── 5. Every user gets a personal workspace ──────────────────────────────
  //
  // This has to happen before the migrations run: the archive-to-project
  // conversion refuses to run for an owner with no workspace membership.
  step("Creating personal workspaces");

  const created = await sql`
    WITH new_orgs AS (
      INSERT INTO "organization" ("id", "name", "slug", "metadata")
      SELECT
        'personal-' || u."id",
        coalesce(nullif(u."name", ''), split_part(u."email", '@', 1)) || '''s Workspace',
        lower(regexp_replace(
          coalesce(nullif(u."name", ''), split_part(u."email", '@', 1)),
          '[^a-zA-Z0-9]+', '-', 'g'
        )) || '-' || left(u."id"::text, 8),
        json_build_object('personal', true, 'userId', u."id")::text
      FROM "user" u
      WHERE NOT EXISTS (
        SELECT 1 FROM "member" m WHERE m."user_id" = u."id"
      )
      RETURNING "id"
    )
    INSERT INTO "member" ("id", "organization_id", "user_id", "role")
    SELECT 'member-' || u."id", 'personal-' || u."id", u."id", 'owner'
    FROM "user" u
    WHERE 'personal-' || u."id" IN (SELECT "id" FROM new_orgs)
    RETURNING "id"
  `;
  note(`${created.length} workspaces created`);

  // ── 6. The rest of the 2.x history ───────────────────────────────────────
  step("Applying migrations");
  await sql.end();

  execFileSync("pnpm", ["tsx", "scripts/db-migrate.ts"], {
    cwd: join(HERE, "../.."),
    stdio: "inherit",
    env: process.env,
  });

  // ── 7. Did anything get lost? ────────────────────────────────────────────
  const verify = postgres(url, { max: 1 });
  const after = {
    users: Number((await verify`SELECT count(*)::text AS n FROM "user"`)[0].n),
    threads: Number(
      (await verify`SELECT count(*)::text AS n FROM "chat_thread"`)[0].n,
    ),
    messages: Number(
      (await verify`SELECT count(*)::text AS n FROM "chat_message"`)[0].n,
    ),
    projects: Number(
      (await verify`SELECT count(*)::text AS n FROM "project"`)[0].n,
    ),
    orphans: Number(
      (
        await verify`
          SELECT count(*)::text AS n FROM "user" u
          WHERE NOT EXISTS (SELECT 1 FROM "member" m WHERE m."user_id" = u."id")
        `
      )[0].n,
    ),
    deployments: Number(
      (await verify`SELECT count(*)::text AS n FROM "model_deployment"`)[0].n,
    ),
  };
  await verify.end();

  step("Verifying");
  const failures: string[] = [];
  if (after.users !== before.users) {
    failures.push(`users: ${before.users} → ${after.users}`);
  }
  if (after.threads !== before.threads) {
    failures.push(`threads: ${before.threads} → ${after.threads}`);
  }
  if (after.messages !== before.messages) {
    failures.push(`messages: ${before.messages} → ${after.messages}`);
  }
  if (after.projects < before.archives) {
    failures.push(
      `projects: ${after.projects}, expected at least ${before.archives} from archives`,
    );
  }
  if (after.orphans > 0) {
    failures.push(`${after.orphans} users without a workspace`);
  }
  if (after.deployments === 0) {
    failures.push("model catalog is empty — model selection will be rejected");
  }

  if (failures.length > 0) {
    console.error("\n❌ The upgrade finished but the checks did not pass:");
    for (const failure of failures) console.error(`   • ${failure}`);
    console.error("\nRestore your backup before using this database.");
    process.exit(1);
  }

  console.log(
    [
      "",
      "✅ Upgrade complete.",
      `   ${after.users} users, ${after.threads} threads, ${after.messages} messages`,
      `   ${after.projects} projects (${before.archives} converted from archives)`,
      "",
      "Set AI_GATEWAY_API_KEY in .env — per-provider keys are no longer read.",
      "",
    ].join("\n"),
  );
} catch (error) {
  console.error("\n❌ Upgrade failed:", error);
  console.error("Restore your backup before using this database.");
  process.exit(1);
}

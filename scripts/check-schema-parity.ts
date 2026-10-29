/**
 * Schema parity check.
 *
 * The migration journal and `schema.pg.ts` are maintained by hand, so they can
 * drift: objects get pushed straight to a deployed database and never receive
 * a migration. A replay then produces a database the code cannot run against —
 * which is exactly how `agent.preset_id`, the organization tables and the model
 * catalog went missing.
 *
 * This replays the journal into one database, pushes the schema into another,
 * and diffs the two. Run it against local throwaway databases only.
 *
 *   POSTGRES_URL=…/parity_replay PARITY_PUSH_URL=…/parity_push \
 *     pnpm tsx scripts/check-schema-parity.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const replayUrl = process.env.POSTGRES_URL;
const pushUrl = process.env.PARITY_PUSH_URL;

if (!replayUrl || !pushUrl) {
  console.error(
    "Set POSTGRES_URL (journal replay target) and PARITY_PUSH_URL (schema push target).",
  );
  process.exit(2);
}
for (const url of [replayUrl, pushUrl]) {
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error(`Refusing to run against a non-local database: ${url}`);
    process.exit(2);
  }
}

/**
 * A migration is applied only when its journal timestamp is newer than the
 * newest one already recorded. An entry that sits out of order is therefore
 * silently skipped on every database that is past it — it applies to a fresh
 * replay and to nothing else, which is how `project_member` came to be missing
 * from databases that had migrated continuously.
 */
function assertJournalIsOrdered(): void {
  const journal = JSON.parse(
    readFileSync(
      "apps/web/src/lib/db/migrations/pg/meta/_journal.json",
      "utf8",
    ),
  ) as { entries: { tag: string; when: number }[] };

  const outOfOrder: string[] = [];
  let highWater = 0;
  for (const entry of journal.entries) {
    if (entry.when < highWater) outOfOrder.push(entry.tag);
    highWater = Math.max(highWater, entry.when);
  }

  if (outOfOrder.length > 0) {
    console.error(
      "\n❌ Migration journal is out of order — these are skipped on any database past them:",
    );
    for (const tag of outOfOrder) console.error(`   ${tag}`);
    process.exit(1);
  }
  console.log(`✅ journal ordered (${journal.entries.length} migrations)`);
}

const COLUMNS_QUERY = `
  SELECT table_name || '.' || column_name || ' ' || data_type ||
         coalesce('(' || character_maximum_length || ')', '') ||
         ' null=' || is_nullable AS signature
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, column_name
`;

async function signatures(url: string): Promise<string[]> {
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql.unsafe<{ signature: string }[]>(COLUMNS_QUERY);
    return rows.map((row) => row.signature);
  } finally {
    await sql.end();
  }
}

const run = (command: string, args: string[], env: Record<string, string>) =>
  execFileSync(command, args, {
    env: { ...process.env, ...env },
    stdio: "inherit",
  });

assertJournalIsOrdered();

console.log("→ replaying migration journal");
run("pnpm", ["tsx", "scripts/db-migrate.ts"], { POSTGRES_URL: replayUrl });

console.log("→ pushing schema");
run("pnpm", ["--filter", "web", "exec", "drizzle-kit", "push", "--force"], {
  POSTGRES_URL: pushUrl,
});

const [replayed, pushed] = await Promise.all([
  signatures(replayUrl),
  signatures(pushUrl),
]);

const replayedSet = new Set(replayed);
const pushedSet = new Set(pushed);
const missing = pushed.filter((s) => !replayedSet.has(s));
const extra = replayed.filter((s) => !pushedSet.has(s));

if (missing.length === 0 && extra.length === 0) {
  console.log(`✅ schema parity clean (${replayed.length} columns)`);
  process.exit(0);
}

if (missing.length > 0) {
  console.error(
    `\n❌ ${missing.length} column(s) in schema.pg.ts that no migration creates:`,
  );
  for (const s of missing) console.error(`   + ${s}`);
}
if (extra.length > 0) {
  console.error(
    `\n❌ ${extra.length} column(s) a replay creates that schema.pg.ts does not declare:`,
  );
  for (const s of extra) console.error(`   - ${s}`);
}
console.error(
  "\nWrite idempotent SQL into a migration until this is clean; do not run drizzle-kit generate.",
);
process.exit(1);

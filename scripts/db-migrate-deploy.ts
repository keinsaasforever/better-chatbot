import "load-env";

/**
 * Prepares the backing services during a Vercel build, so a deployment never
 * boots against an empty database or a storage project without buckets.
 * Boot itself skips migrations on Vercel (`instrumentation.ts`), which makes
 * the build the one place they run.
 *
 * Fails the build rather than shipping an app whose schema does not match.
 * Missing buckets only warn: chat works without file storage.
 */
if (!process.env.POSTGRES_URL?.trim() && !process.env.DATABASE_URL?.trim()) {
  console.error(
    "❌ No database configured. Connect Supabase (or another Postgres with pgvector) to the project in Vercel under Storage, or set POSTGRES_URL, and redeploy.",
  );
  process.exit(1);
}

const { runMigrate } = await import("lib/db/pg/migrate.pg");

try {
  await runMigrate();
} catch {
  console.error(
    "❌ Database migrations failed (details above). Check that the database is reachable from the build and that it offers the pgvector extension.",
  );
  process.exit(1);
}

await ensureStorageBuckets();
process.exit(0);

/**
 * Creates the Supabase Storage buckets the app uploads into, when Supabase is
 * connected and they do not exist yet. Names honour the same overrides the
 * app reads. Uses the Storage REST API so the build needs no extra package.
 */
async function ensureStorageBuckets() {
  const base = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!base || !key) {
    console.info(
      "ℹ️ Supabase Storage not connected; file uploads stay off until it is.",
    );
    return;
  }

  const buckets = [
    {
      id: process.env.SUPABASE_ATTACHMENT_BUCKET || "attachments",
      public: false,
    },
    { id: process.env.SUPABASE_AVATAR_BUCKET || "avatars", public: true },
    {
      id: process.env.SUPABASE_AI_GENERATED_BUCKET || "ai-generated",
      public: true,
    },
  ];
  // The newer sb_secret_ keys are not JWTs and go in `apikey` only.
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
    ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
  };

  for (const bucket of buckets) {
    try {
      const existing = await fetch(
        `${base}/storage/v1/bucket/${encodeURIComponent(bucket.id)}`,
        { headers },
      );
      if (existing.ok) continue;
      const created = await fetch(`${base}/storage/v1/bucket`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: bucket.id,
          name: bucket.id,
          public: bucket.public,
        }),
      });
      if (!created.ok) {
        throw new Error(`HTTP ${created.status}: ${await created.text()}`);
      }
      console.info(`✅ Created storage bucket "${bucket.id}"`);
    } catch (error) {
      console.warn(
        `⚠️ Could not create storage bucket "${bucket.id}": ${error instanceof Error ? error.message : error}. Create it in the Supabase dashboard under Storage.`,
      );
    }
  }
}

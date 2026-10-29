import { sql } from "drizzle-orm";
import { pgDb } from "../apps/web/src/lib/db/pg/db.pg";

async function main() {
  console.log("Applying artifact integration schema migrations...");

  await pgDb.execute(sql`
    CREATE TABLE IF NOT EXISTS document_edit (
      id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES document(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      change_id TEXT NOT NULL,
      del_w_id TEXT,
      ins_w_id TEXT,
      deleted_text TEXT NOT NULL DEFAULT '',
      inserted_text TEXT NOT NULL DEFAULT '',
      context_before TEXT NOT NULL DEFAULT '',
      context_after TEXT NOT NULL DEFAULT '',
      reason TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      edited_storage_key TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log("✓ document_edit table");

  await pgDb.execute(sql`
    CREATE INDEX IF NOT EXISTS document_edit_document_id_idx ON document_edit(document_id);
  `);
  await pgDb.execute(sql`
    CREATE INDEX IF NOT EXISTS document_edit_user_id_idx ON document_edit(user_id);
  `);
  await pgDb.execute(sql`
    CREATE INDEX IF NOT EXISTS document_edit_change_id_idx ON document_edit(change_id);
  `);

  await pgDb.execute(sql`
    CREATE TABLE IF NOT EXISTS tabular_review (
      id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      columns JSON NOT NULL DEFAULT '[]',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log("✓ tabular_review table");

  await pgDb.execute(sql`
    CREATE INDEX IF NOT EXISTS tabular_review_user_id_idx ON tabular_review(user_id);
  `);

  await pgDb.execute(sql`
    CREATE TABLE IF NOT EXISTS tabular_review_document (
      id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
      review_id UUID NOT NULL REFERENCES tabular_review(id) ON DELETE CASCADE,
      document_id UUID NOT NULL REFERENCES document(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT tabular_review_doc_unique UNIQUE (review_id, document_id)
    );
  `);
  console.log("✓ tabular_review_document table");

  await pgDb.execute(sql`
    CREATE INDEX IF NOT EXISTS tabular_review_doc_review_idx ON tabular_review_document(review_id);
  `);

  await pgDb.execute(sql`
    CREATE TABLE IF NOT EXISTS tabular_cell (
      id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
      review_id UUID NOT NULL REFERENCES tabular_review(id) ON DELETE CASCADE,
      document_id UUID NOT NULL REFERENCES document(id) ON DELETE CASCADE,
      column_id TEXT NOT NULL,
      value TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT tabular_cell_unique UNIQUE (review_id, document_id, column_id)
    );
  `);
  console.log("✓ tabular_cell table");

  await pgDb.execute(sql`
    CREATE INDEX IF NOT EXISTS tabular_cell_review_id_idx ON tabular_cell(review_id);
  `);
  await pgDb.execute(sql`
    CREATE INDEX IF NOT EXISTS tabular_cell_document_id_idx ON tabular_cell(document_id);
  `);

  console.log("\n✅ All artifact integration tables applied successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

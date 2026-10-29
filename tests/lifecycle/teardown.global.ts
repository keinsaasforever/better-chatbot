import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  UserTable,
  SessionTable,
  AgentTable,
  BookmarkTable,
  ChatThreadTable,
} from "../../apps/web/src/lib/db/pg/schema.pg";
import { eq, like, or } from "drizzle-orm";
import { config } from "dotenv";

config();

const client = postgres(process.env.POSTGRES_URL!, { prepare: false });
const db = drizzle(client);

async function cleanup() {
  console.log("Cleaning up test data...");

  try {
    // Clean up only dynamically created test users (not seeded ones)
    // Preserve our seeded test users in @test-seed.local domain
    const testEmailPatterns = [
      "%playwright%", // Dynamically created playwright users
      "%@example.com%", // Test signup users
      "%@temp-test.%", // Temporary test users
    ];

    // First, get all test users
    const testUsers = await db
      .select({ id: UserTable.id })
      .from(UserTable)
      .where(
        or(
          ...testEmailPatterns.map((pattern) => like(UserTable.email, pattern)),
        ),
      );

    console.log(`Found ${testUsers.length} test users to clean up`);

    // Delete in reverse order due to foreign key constraints
    for (const user of testUsers) {
      console.log(`Cleaning up user: ${user.id}`);

      // Delete chat threads
      await db
        .delete(ChatThreadTable)
        .where(eq(ChatThreadTable.userId, user.id));

      // Delete bookmarks
      await db.delete(BookmarkTable).where(eq(BookmarkTable.userId, user.id));

      // Delete agents
      await db.delete(AgentTable).where(eq(AgentTable.userId, user.id));

      // Delete sessions
      await db.delete(SessionTable).where(eq(SessionTable.userId, user.id));

      // Delete user
      await db.delete(UserTable).where(eq(UserTable.id, user.id));
    }

    console.log("Test data cleaned up successfully");
  } catch (error) {
    console.error("Error cleaning up test data:", error);
  }

  process.exit(0);
}

export default cleanup;

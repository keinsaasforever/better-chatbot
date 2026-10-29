#!/usr/bin/env tsx
/**
 * Script to clean up ALL test data including seeded users
 * Use this when you want to completely reset the test environment
 *
 * Usage:
 *   npm run cleanup:all-test-data
 *   pnpm cleanup:all-test-data
 */

import { config } from "dotenv";

// Load environment variables FIRST
if (process.env.CI) {
  config({ path: ".env.test" });
} else {
  config();
}

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { UserTable } from "../apps/web/src/lib/db/pg/schema.pg";
import { like } from "drizzle-orm";

// Create database connection
const db = drizzle(process.env.POSTGRES_URL!);

async function cleanupAllTestData() {
  console.log("🧹 Cleaning up ALL test data including seeded users...");

  try {
    // Define all test email patterns to completely clean up
    const allTestPatterns = [
      "%@test-seed.local%", // Our main seeded test domain
      "%playwright%", // Dynamically created playwright users
      "%@example.com%", // General test signup users
      "%@temp-test.%", // Temporary test users
      "%testuser%@testuser.com%", // Legacy test users
      "%testuser%@gmail.com%", // Legacy test users
    ];

    console.log("Deleting users matching ALL test patterns...");

    for (const pattern of allTestPatterns) {
      await db.delete(UserTable).where(like(UserTable.email, pattern));
      console.log(`  Deleted users matching pattern: ${pattern}`);
    }

    // Also clean up any remaining legacy test users by exact email match
    const legacyTestEmails = [
      "admin@testuser.com",
      "editor@testuser.com",
      "user@testuser.com",
    ];

    for (let i = 4; i <= 50; i++) {
      legacyTestEmails.push(`testuser${i}@testuser.com`);
      legacyTestEmails.push(`testuser${i}@gmail.com`);
    }

    if (legacyTestEmails.length > 0) {
      console.log("Cleaning up any remaining legacy test emails...");
      for (const email of legacyTestEmails) {
        await db.delete(UserTable).where(sql`email = ${email}`);
      }
    }

    console.log(`✅ Cleanup completed!`);

    // Check remaining user count
    const remainingUsers = await db.$count(UserTable);
    console.log(`📊 Remaining users in database: ${remainingUsers}`);
  } catch (error) {
    console.error("❌ Error during cleanup:", error);
    throw error;
  }
}

// Run the cleanup if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupAllTestData()
    .then(() => {
      console.log("🎉 All test data cleanup completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Cleanup failed:", error);
      process.exit(1);
    });
}

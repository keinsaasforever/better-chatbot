/**
 * Migration script: Create personal organizations for existing users
 *
 * Run with: pnpm tsx scripts/migrate-users-to-orgs.ts
 */
import "load-env";
import { auth } from "@/lib/auth/auth-instance";
import { pgDb } from "@/lib/db/pg/db.pg";
import { UserTable } from "@/lib/db/pg/schema.pg";
import logger from "logger";

async function migrateUsersToOrganizations() {
  logger.info("Starting user-to-organization migration...");

  try {
    const users = await pgDb.select().from(UserTable);
    logger.info(`Found ${users.length} users to process`);

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        // Check if user already has organizations
        const existingOrgs = await auth.api.listOrganizations({
          headers: new Headers({ "x-user-id": user.id }),
        });

        // Simple check - if user is a member of any org, skip
        if (existingOrgs && existingOrgs.length > 0) {
          logger.info(`User ${user.email} already has organizations, skipping`);
          skipCount++;
          continue;
        }

        // Create personal organization
        const safeName = (user.name || user.email.split("@")[0])
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .slice(0, 30);
        const slug = `${safeName}-${user.id.slice(0, 8)}`;

        await auth.api.createOrganization({
          body: {
            name: `${user.name || user.email.split("@")[0]}'s Workspace`,
            slug,
            userId: user.id,
            metadata: { personal: true, userId: user.id } as Record<
              string,
              any
            >,
          },
        });

        logger.info(`✅ Created personal org for ${user.email}`);
        successCount++;
      } catch (error) {
        logger.error(`❌ Failed to migrate user ${user.email}:`, error);
        errorCount++;
      }
    }

    logger.info("\n=== Migration Complete ===");
    logger.info(`Total users: ${users.length}`);
    logger.info(`Successfully migrated: ${successCount}`);
    logger.info(`Skipped (already migrated): ${skipCount}`);
    logger.info(`Errors: ${errorCount}`);
  } catch (error) {
    logger.error("Migration failed:", error);
    process.exit(1);
  }
}

migrateUsersToOrganizations();

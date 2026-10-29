import "server-only";

import { pgDb } from "@/lib/db/pg/db.pg";
import { MemberTable, UserTable } from "@/lib/db/pg/schema.pg";
import { and, eq } from "drizzle-orm";

export type OrganizationMemberRow = {
  id: string;
  role: string;
  userId: string;
  user: {
    name: string | null;
    email: string | null;
    image: string | null;
  };
};

export async function fetchOrganizationMembers(
  organizationId: string,
): Promise<OrganizationMemberRow[]> {
  const rows = await pgDb
    .select({
      id: MemberTable.id,
      role: MemberTable.role,
      userId: MemberTable.userId,
      user: {
        name: UserTable.name,
        email: UserTable.email,
        image: UserTable.image,
      },
    })
    .from(MemberTable)
    .leftJoin(UserTable, eq(MemberTable.userId, UserTable.id))
    .where(eq(MemberTable.organizationId, organizationId));

  return rows.map((row) => ({
    ...row,
    user: row.user ?? { name: null, email: null, image: null },
  }));
}

export async function isUserMemberOfOrganization(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const membership = await pgDb
    .select({ id: MemberTable.id })
    .from(MemberTable)
    .where(
      and(
        eq(MemberTable.organizationId, organizationId),
        eq(MemberTable.userId, userId),
      ),
    )
    .limit(1);

  return membership.length > 0;
}

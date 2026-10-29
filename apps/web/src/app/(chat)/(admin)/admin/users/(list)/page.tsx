import { UsersTable } from "@/components/admin/users-table";
import {
  ADMIN_USER_LIST_LIMIT,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_DIRECTION,
} from "lib/admin/server";
import { getAdminUsers } from "lib/admin/server";
import { requireAdminPermission } from "auth/permissions";
import { getSession } from "lib/auth/server";
import { redirect, unauthorized } from "next/navigation";

// Force dynamic rendering to avoid static generation issues with session
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    page?: string;
    limit?: string;
    query?: string;
    sortBy?: string;
    sortDirection?: "asc" | "desc";
  }>;
}

export default async function UserListPage({ searchParams }: PageProps) {
  // Redirect before rendering the page if the user is not an admin

  try {
    await requireAdminPermission();
  } catch (_error) {
    unauthorized();
  }
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const params = await searchParams;
  const page = parseInt(params.page ?? "1", 10);
  const limit = parseInt(params.limit ?? ADMIN_USER_LIST_LIMIT.toString(), 10);
  const offset = (page - 1) * limit;
  const sortBy = params.sortBy ?? DEFAULT_SORT_BY;
  const sortDirection = params.sortDirection ?? DEFAULT_SORT_DIRECTION;

  const result = await getAdminUsers({
    searchValue: params.query,
    searchField: "email",
    searchOperator: "contains",
    limit,
    offset,
    sortBy,
    sortDirection,
  });

  return (
    <UsersTable
      users={result.users}
      currentUserId={session.user.id}
      total={result.total}
      page={page}
      limit={limit}
      query={params.query}
      baseUrl="/admin/users"
      sortBy={sortBy}
      sortDirection={sortDirection}
    />
  );
}

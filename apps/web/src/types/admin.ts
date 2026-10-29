import type { User } from "./user";

export interface AdminUsersQuery {
  searchValue?: string;
  searchField?: "name" | "email";
  searchOperator?: "contains" | "starts_with" | "ends_with";
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  filterField?: string;
  filterValue?: string | number | boolean;
  filterOperator?: "lt" | "eq" | "ne" | "lte" | "gt" | "gte" | "contains";
}

// Better Auth's UserWithRole type - minimal definition for list view
export type AdminUserListItem = Omit<
  User,
  | "password"
  | "preferences"
  | "image"
  | "role"
  | "banned"
  | "banReason"
  | "banExpires"
> & {
  image?: string | null;
  role?: string | null;
  banned?: boolean | null;
  banReason?: string | null;
  banExpires?: Date | null;
};

export interface AdminUsersPaginated {
  users: AdminUserListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminUpdateUserDetailsData {
  userId: string;
  name?: string;
  email?: string;
  image?: string;
}

// Admin only repository methods
export type AdminRepository = {
  // User queries
  getUsers: (query?: AdminUsersQuery) => Promise<AdminUsersPaginated>;
};

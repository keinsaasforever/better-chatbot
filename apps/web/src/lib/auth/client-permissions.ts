// Client-side permission helpers
// These mirror the server-side permissions but work with the client session

import { admin, editor, user as userRole } from "./roles";
import type { BetterAuthRole } from "./types";
import { parseRoleString, isBetterAuthRole } from "./types";

/**
 * Get the role permissions based on user's role string
 * Defaults to 'user' role if undefined or null
 */
function getRolePermissions(role: string | undefined | null): BetterAuthRole {
  const cleanRole = parseRoleString(role);

  // Default to 'user' role if no role is provided
  switch (cleanRole) {
    case "admin":
      return admin as BetterAuthRole;
    case "editor":
      return editor as BetterAuthRole;
    case "user":
    default:
      return userRole as BetterAuthRole;
  }
}

/**
 * Check if role has specific permission for a resource
 */
function hasPermission(
  userRoleString: string | undefined | null,
  permission:
    | "use"
    | "create"
    | "list"
    | "delete"
    | "update"
    | "view"
    | "share",
  resource: "agent" | "workflow" | "mcp",
): boolean {
  const roleObject = getRolePermissions(userRoleString);

  // Validate role object structure
  if (!isBetterAuthRole(roleObject)) {
    console.error("Invalid role object structure");
    return false;
  }

  const statements = roleObject.statements;
  const resourcePermissions = statements[resource] || [];
  return (
    Array.isArray(resourcePermissions) &&
    resourcePermissions.includes(permission)
  );
}

/**
 * Check if user can create agents (client-side)
 */
export function canCreateAgent(userRoleString?: string | null): boolean {
  return hasPermission(userRoleString, "create", "agent");
}

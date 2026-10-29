/**
 * Type definitions for Better Auth role system
 */

import type { PERMISSION_TYPES } from "app-types/permissions";

type PermissionType = (typeof PERMISSION_TYPES)[keyof typeof PERMISSION_TYPES];

/**
 * Better Auth role object structure
 */
export interface BetterAuthRole {
  statements: {
    user?: readonly string[];
    session?: readonly string[];
    workflow?: readonly PermissionType[];
    agent?: readonly PermissionType[];
    mcp?: readonly PermissionType[];
    chat?: readonly PermissionType[];
    temporaryChat?: readonly PermissionType[];
    [key: string]: readonly string[] | undefined;
  };
}

/**
 * Valid role names in the system
 */
export type RoleName = "admin" | "editor" | "user";

/**
 * Validates and cleans a role string, handling OAuth provider prefixes
 */
export function parseRoleString(role: string | undefined | null): RoleName {
  if (!role) return "user";

  // Handle OAuth roles that may be prefixed with provider name (e.g., "google:editor")
  // Use lastIndexOf to handle cases with multiple colons safely
  let cleanRole: string;
  const lastColonIndex = role.lastIndexOf(":");

  if (lastColonIndex !== -1) {
    // Extract everything after the last colon
    cleanRole = role.substring(lastColonIndex + 1).trim();
  } else {
    cleanRole = role.trim();
  }

  // Validate the role is one of our known roles
  const validRoles: RoleName[] = ["admin", "editor", "user"];

  // Normalize to lowercase for comparison, then return proper case
  const normalizedRole = cleanRole.toLowerCase();

  if (!normalizedRole || !validRoles.includes(normalizedRole as RoleName)) {
    console.warn(`Invalid role detected: ${role}, defaulting to user`);
    return "user";
  }

  return normalizedRole as RoleName;
}

/**
 * Type guard to check if an object is a BetterAuthRole
 */
export function isBetterAuthRole(obj: unknown): obj is BetterAuthRole {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "statements" in obj &&
    typeof (obj as any).statements === "object"
  );
}

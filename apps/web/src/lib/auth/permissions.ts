import "server-only";
import { getSession } from "./auth-instance";
import { getIsUserAdmin } from "lib/user/utils";
import { admin, editor, user as userRole } from "./roles";
import type { BetterAuthRole } from "./types";
import { parseRoleString, isBetterAuthRole } from "./types";

/**
 * Simple permission helpers that wrap Better Auth's role system
 *
 * Philosophy:
 * - Keep it simple and clear
 * - Users can always manage themselves
 * - Only admins can manage other users
 * - Easy to show/hide UI elements
 * - Easy to extend for workflows, etc. later
 */

/**
 * Check if user has admin permissions (for showing/hiding admin areas)
 */
export async function hasAdminPermission(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.user) return false;

    const isAdmin = getIsUserAdmin(session.user);
    return isAdmin;
  } catch (error) {
    console.error("Error checking admin permission:", error);
    return false;
  }
}

/**
 * Check if user can list other users
 * Currently: only admins can list users
 */
export async function canListUsers(): Promise<boolean> {
  return await hasAdminPermission();
}

/**
 * Check if user can manage other users (create, edit, delete, etc.)
 * Currently: only admins can manage other users
 */
export async function canManageUsers(): Promise<boolean> {
  return await hasAdminPermission();
}

/**
 * Check if user can manage a specific user (themselves OR has manage permission)
 */
export async function canManageUser(targetUserId: string): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.user) return false;

    // Can always manage own profile
    if (session.user.id === targetUserId) return true;

    // Or has admin permissions to manage other users
    return await canManageUsers();
  } catch (error) {
    console.error("Error checking user management permission:", error);
    return false;
  }
}

/**
 * Require admin permissions or throw error
 */
export async function requireAdminPermission(
  action: string = "perform this action",
): Promise<void> {
  const hasPermission = await hasAdminPermission();
  if (!hasPermission) {
    throw new Error(`Unauthorized: Admin access required to ${action}`);
  }
}

/**
 * Require user list permissions or throw error
 */
export async function requireUserListPermission(
  action: string = "list users",
): Promise<void> {
  const hasPermission = await canListUsers();
  if (!hasPermission) {
    throw new Error(`Unauthorized: Permission required to ${action}`);
  }
}

/**
 * Require user management permissions or throw error
 */
export async function requireUserManagePermission(
  action: string = "manage users",
): Promise<void> {
  const hasPermission = await canManageUsers();
  if (!hasPermission) {
    throw new Error(`Unauthorized: Permission required to ${action}`);
  }
}

/**
 * Require permission to manage specific user or throw error
 */
export async function requireUserManagePermissionFor(
  targetUserId: string,
  action: string = "manage this user",
): Promise<void> {
  const hasPermission = await canManageUser(targetUserId);
  if (!hasPermission) {
    throw new Error(`Unauthorized: Permission required to ${action}`);
  }
}

/**
 * Get current user session or null
 */
export async function getCurrentUser() {
  try {
    const session = await getSession();
    return session?.user || null;
  } catch {
    return null;
  }
}

/**
 * Sync role check: admins and editors may create/edit resources. Use when the
 * role string is already in hand (e.g. from a session in a route handler);
 * hasEditorPermission() is the session-fetching async variant.
 */
export function isAdminOrEditor(role?: string | null): boolean {
  return role === "admin" || role === "editor";
}

/**
 * Check if user is editor or admin (can create/edit resources)
 */
export async function hasEditorPermission(): Promise<boolean> {
  try {
    const session = await getSession();
    return isAdminOrEditor(session?.user?.role);
  } catch (error) {
    console.error("Error checking editor permission:", error);
    return false;
  }
}

/**
 * Get the role permissions based on user's role string
 */
function getRolePermissions(role: string | undefined | null): BetterAuthRole {
  const cleanRole = parseRoleString(role);

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
 * Check if role has specific permission for a resource.
 *
 * Exported for callers that authenticate without a session cookie (Navigator
 * API keys, the voice tool relay): they hold the user's role, not a request to
 * read one from, so the session-reading helpers below cannot serve them.
 */
export function roleHasPermission(
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
 * Check if user can create agents
 */
export async function canCreateAgent(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.user) return false;

    return roleHasPermission(session.user.role, "create", "agent");
  } catch (error) {
    console.error("Error checking agent create permission:", error);
    return false;
  }
}

/**
 * Check if user can edit agents
 */
export async function canEditAgent(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.user) return false;

    return roleHasPermission(session.user.role, "update", "agent");
  } catch (error) {
    console.error("Error checking agent edit permission:", error);
    return false;
  }
}

/**
 * Check if user can delete agents
 */
export async function canDeleteAgent(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.user) return false;

    return roleHasPermission(session.user.role, "delete", "agent");
  } catch (error) {
    console.error("Error checking agent delete permission:", error);
    return false;
  }
}

/**
 * Check if user can create workflows
 */
export async function canCreateWorkflow(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.user) return false;

    return roleHasPermission(session.user.role, "create", "workflow");
  } catch (error) {
    console.error("Error checking workflow create permission:", error);
    return false;
  }
}

/**
 * Check if user can edit workflows
 */
export async function canEditWorkflow(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.user) return false;

    return roleHasPermission(session.user.role, "update", "workflow");
  } catch (error) {
    console.error("Error checking workflow edit permission:", error);
    return false;
  }
}

/**
 * Check if user can delete workflows
 */
export async function canDeleteWorkflow(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.user) return false;

    return roleHasPermission(session.user.role, "delete", "workflow");
  } catch (error) {
    console.error("Error checking workflow delete permission:", error);
    return false;
  }
}

/**
 * Check if user can create MCP connections
 */
export async function canCreateMCP(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.user) return false;

    return roleHasPermission(session.user.role, "create", "mcp");
  } catch (error) {
    console.error("Error checking MCP create permission:", error);
    return false;
  }
}

/**
 * Check if user can edit MCP connections
 */
export async function canEditMCP(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.user) return false;

    return roleHasPermission(session.user.role, "update", "mcp");
  } catch (error) {
    console.error("Error checking MCP edit permission:", error);
    return false;
  }
}

/**
 * Check if user can change visibility of MCP connections
 */
export async function canChangeVisibilityMCP(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.user) return false;

    return roleHasPermission(session.user.role, "share", "mcp");
  } catch (error) {
    console.error("Error checking MCP visibility change permission:", error);
    return false;
  }
}

/**
 * Check if user can delete MCP connections
 */
export async function canDeleteMCP(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.user) return false;

    return roleHasPermission(session.user.role, "delete", "mcp");
  } catch (error) {
    console.error("Error checking MCP delete permission:", error);
    return false;
  }
}

/**
 * Require editor permissions or throw error
 */
export async function requireEditorPermission(
  action: string = "perform this action",
): Promise<void> {
  const hasPermission = await hasEditorPermission();
  if (!hasPermission) {
    throw new Error(
      `Unauthorized: Editor or Admin access required to ${action}`,
    );
  }
}

/**
 * Check if user can manage a specific MCP server
 * Users can manage their own servers, admins can manage all
 */
export async function canManageMCPServer(mcpOwnerId: string): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.user) return false;

    // Admins can manage all MCP servers
    if (session.user.role === "admin") return true;

    // Owner always has access, regardless of visibility (matches
    // mcpRepository.checkAccess). Gating this on visibility === "private" locked
    // owners out of their own shared servers — including the Authorize button.
    if (session.user.id === mcpOwnerId) return true;

    return false;
  } catch (error) {
    console.error("Error checking MCP management permission:", error);
    return false;
  }
}

/**
 * Check if user can share MCP servers (admin only)
 */
export async function canShareMCPServer(): Promise<boolean> {
  return await hasAdminPermission();
}

/**
 * Organization plugin access control (Better Auth organization plugin).
 * Kept in one module and passed to both server `organization()` and client
 * `organizationClient()` so permission checks stay aligned.
 *
 * Mirrors default org roles from better-auth (owner/admin can invite; member cannot).
 */
import { createAccessControl } from "better-auth/plugins/access";

const organizationStatements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const;

export const organizationAc = createAccessControl(organizationStatements);

export const organizationRoles = {
  admin: organizationAc.newRole({
    organization: ["update"],
    invitation: ["create", "cancel"],
    member: ["create", "update", "delete"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
  }),
  owner: organizationAc.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
  }),
  member: organizationAc.newRole({
    organization: [],
    member: [],
    invitation: [],
    team: [],
    ac: ["read"],
  }),
};

"use client";

import { createAuthClient } from "better-auth/react"; // make sure to import from better-auth/react
import {
  adminClient,
  inferAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";

import { DEFAULT_USER_ROLE, USER_ROLES } from "app-types/roles";
import { ac, admin, editor, user } from "./roles";
import { organizationAc, organizationRoles } from "./organization-permissions";
import type { auth } from "./auth-instance";

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<typeof auth>(),
    adminClient({
      defaultRole: DEFAULT_USER_ROLE,
      adminRoles: [USER_ROLES.ADMIN],
      ac,
      roles: {
        admin,
        editor,
        user,
      },
    }),
    organizationClient({
      ac: organizationAc,
      roles: organizationRoles,
    }),
  ],
});

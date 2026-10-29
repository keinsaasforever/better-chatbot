import { DEFAULT_USER_ROLE, USER_ROLES } from "app-types/roles";
// Base auth instance without "server-only" - can be used in seed scripts
import { apiKey } from "@better-auth/api-key";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import {
  admin as adminPlugin,
  organization as organizationPlugin,
  oneTimeToken,
} from "better-auth/plugins";
import { buildCaptchaPlugins } from "./captcha-plugin";
import { signUpPasswordPolicy } from "./signup-password-policy";
import { eq, sql } from "drizzle-orm";
import { pgDb } from "lib/db/pg/db.pg";
import {
  AccountTable,
  ApiKeyTable,
  InvitationTable,
  MemberAiPolicyTable,
  MemberTable,
  OrganizationTable,
  SessionTable,
  UserTable,
  VerificationTable,
} from "lib/db/pg/schema.pg";
import { userRepository } from "lib/db/repository";
import { isPersonalOrg } from "lib/organization/billing-identity";
import { resolveDefaultActiveOrganizationId } from "lib/organization/default-org";
import { promoteSharedPersonalOrganization } from "lib/organization/promote-shared-org";
import { adoptTeamWorkspaceInSessions } from "lib/organization/stale-active-workspace";
import {
  defaultMemberCapMicros,
  isPersonalOrgMetadata,
} from "lib/organization/member-cap";
import logger from "logger";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { getAuthConfig } from "./config";
import { organizationAc, organizationRoles } from "./organization-permissions";
import { ac, admin, editor, user } from "./roles";

const {
  emailAndPasswordEnabled,
  signUpEnabled,
  socialAuthenticationProviders,
} = getAuthConfig();

/**
 * Better Auth CSRF / Origin allowlist. Browsers send `Origin` for the page URL;
 * it must match one of these when it differs from `baseURL` (e.g. dev vs prod).
 * @see https://better-auth.com/docs/reference/options#trustedorigins
 */
function buildBetterAuthTrustedOrigins(): string[] {
  const origins = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value?.trim()) return;
    try {
      const url = value.includes("://")
        ? new URL(value)
        : new URL(`https://${value}`);
      origins.add(url.origin);
    } catch {
      // ignore malformed URLs
    }
  };

  add(process.env.BETTER_AUTH_URL);
  add(process.env.NEXT_PUBLIC_BASE_URL);
  for (const part of process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(",") ??
    []) {
    add(part.trim());
  }

  return [...origins];
}

/**
 * The org (if any) this user already belongs to as a real *team* membership,
 * ignoring personal "Workspace" orgs and an optionally-excluded org id. Used to
 * enforce "a user can only be part of one organization": invites/accepts that
 * would place a user in a second team org are rejected.
 *
 * A personal workspace must never count here — otherwise an existing solo user
 * (who was auto-given a workspace at sign-up) could never be invited anywhere.
 * Detection is deliberately robust: the `metadata.personal` flag OR the legacy
 * `personal-` id prefix OR — for older workspaces created before the flag
 * existed — an org the user solely owns (they are the only member, as owner).
 */
async function findOtherTeamOrganization(
  userId: string,
  excludeOrganizationId: string,
): Promise<{ id: string; name: string } | undefined> {
  const rows = await pgDb
    .select({
      id: OrganizationTable.id,
      name: OrganizationTable.name,
      metadata: OrganizationTable.metadata,
      role: MemberTable.role,
    })
    .from(MemberTable)
    .innerJoin(
      OrganizationTable,
      eq(MemberTable.organizationId, OrganizationTable.id),
    )
    .where(eq(MemberTable.userId, userId));

  for (const row of rows) {
    if (row.id === excludeOrganizationId) continue;
    // Explicitly-flagged (or legacy-prefixed) personal workspaces never count.
    if (isPersonalOrg({ id: row.id, metadata: row.metadata })) {
      continue;
    }
    // A user invited into a real org holds a non-owner role there → it counts.
    if (row.role !== "owner") return { id: row.id, name: row.name };
    // Owner without the personal flag: older auto-created workspaces predate the
    // metadata tag. Treat a solo-owned org (only this user in it) as personal;
    // only count it when the org actually has other members.
    const members = await pgDb
      .select({ id: MemberTable.id })
      .from(MemberTable)
      .where(eq(MemberTable.organizationId, row.id));
    if (members.length > 1) return { id: row.id, name: row.name };
  }
  return undefined;
}

async function findUserIdByEmail(email: string): Promise<string | undefined> {
  const [row] = await pgDb
    .select({ id: UserTable.id })
    .from(UserTable)
    .where(sql`lower(${UserTable.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return row?.id;
}

/**
 * Seed the default monthly AI allowance for a freshly-joined member. Team
 * members (role !== "owner") are capped at €15/month by default; owners and
 * personal-workspace members are left uncapped. Never overwrites an existing
 * policy row (admins can edit caps in the AI-policy tab).
 */
async function seedDefaultMemberCap(member: {
  id: string;
  role: string;
  organizationId: string;
}): Promise<void> {
  const [org] = await pgDb
    .select({ metadata: OrganizationTable.metadata })
    .from(OrganizationTable)
    .where(eq(OrganizationTable.id, member.organizationId))
    .limit(1);

  const cap = defaultMemberCapMicros({
    role: member.role,
    orgIsPersonal: isPersonalOrgMetadata(org?.metadata),
  });
  if (cap == null) return;

  await pgDb
    .insert(MemberAiPolicyTable)
    .values({ memberId: member.id, monthlyCapMicros: cap, hardStop: true })
    .onConflictDoNothing();
}

/**
 * Create a user's personal workspace.
 *
 * Called at sign-up, and again at sign-in for anyone who ended up without one —
 * creation is best-effort there and its failure was swallowed, which left the
 * account with no membership at all. That is not a cosmetic gap: billing
 * resolves the Autumn customer from membership, so a user with no workspace
 * bills to a bare user id and can never share an organization's credits.
 */
async function createPersonalOrganization(user: {
  id: string;
  name?: string | null;
  email: string;
}): Promise<void> {
  const label = user.name || user.email.split("@")[0];
  const safeName = label
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 30);

  logger.info(`Creating personal organization for user ${user.email}`);

  await auth.api.createOrganization({
    body: {
      name: `${label}'s Workspace`,
      slug: `${safeName}-${user.id.slice(0, 8)}`,
      userId: user.id,
      metadata: { personal: true, userId: user.id } as Record<string, any>,
    },
  });
}

/**
 * Shared tail of both "a member joined" hooks. Promotion runs first so the cap
 * seeding and the session move below both see the organization's real type.
 */
async function onMemberJoined(member: {
  id: string;
  role: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  try {
    await promoteSharedPersonalOrganization(member.organizationId);
  } catch (error) {
    logger.error("Failed to clear the personal-workspace flag:", error);
  }

  try {
    await seedDefaultMemberCap(member);
  } catch (error) {
    logger.error("Failed to seed default member AI cap:", error);
  }

  // A session created before this membership keeps the workspace it was
  // stamped with at sign-in, and billing follows that workspace — so without
  // this the new member spends their own credits, not the organization's.
  try {
    await adoptTeamWorkspaceInSessions({
      userId: member.userId,
      organizationId: member.organizationId,
    });
  } catch (error) {
    logger.error(
      "Failed to move the member's sessions to the team workspace:",
      error,
    );
  }
}

const trustedOrigins = buildBetterAuthTrustedOrigins();

/**
 * Cloudflare Turnstile, off unless a secret is configured. Every public
 * sign-up/sign-in path has to reach Better Auth over the HTTP handler to be
 * covered — see `./captcha-plugin`.
 *
 * Registered at the `betterAuth()` call rather than inside `options.plugins`:
 * spreading a conditional array into that literal costs Better Auth the
 * positional inference it derives `auth`'s session/user shape from, and
 * `session.activeOrganizationId` and `user.role` silently vanish app-wide.
 */
const captchaPlugins = buildCaptchaPlugins(process.env.TURNSTILE_SECRET_KEY);

const options = {
  secret: process.env.BETTER_AUTH_SECRET!,
  ...(trustedOrigins.length > 0 ? { trustedOrigins } : {}),
  hooks: { before: signUpPasswordPolicy },
  plugins: [
    adminPlugin({
      defaultRole: DEFAULT_USER_ROLE,
      adminRoles: [USER_ROLES.ADMIN],
      ac,
      roles: {
        admin,
        editor,
        user,
      },
    }),
    organizationPlugin({
      ac: organizationAc,
      roles: organizationRoles,
      async sendInvitationEmail(data) {
        // Fire-and-forget: email failure must never cause the invite-member
        // endpoint to return 500. All errors are swallowed and logged.
        try {
          const baseUrl =
            process.env.BETTER_AUTH_URL ||
            process.env.NEXT_PUBLIC_BASE_URL ||
            "https://keinsaas.com";
          const inviteLink = `${baseUrl}/accept-invitation/${data.id}`;

          const { sendOrgInvitationEmail } = await import("@/lib/gate");
          await sendOrgInvitationEmail({
            email: data.email,
            inviteLink,
            // name may be null if the inviter hasn't set one — fall back to email
            invitedByUsername:
              data.inviter.user.name || data.inviter.user.email,
            invitedByEmail: data.inviter.user.email,
            teamName: data.organization.name,
          });
        } catch (error) {
          // Log but never rethrow — Better Auth must not see this error
          logger.error("Failed to send invitation email:", error);
        }
      },
      allowUserToCreateOrganization: true,
      organizationLimit: 10,
      // Re-inviting an email with a live pending invite refreshes it in place
      // instead of leaving a stale row behind.
      cancelPendingInvitationsOnReInvite: true,
      organizationHooks: {
        // Enforce "a user belongs to only one organization": reject inviting an
        // email that already belongs to a different team org. Personal
        // workspaces and unknown (not-yet-registered) emails don't block.
        beforeCreateInvitation: async ({ invitation }) => {
          const userId = await findUserIdByEmail(invitation.email);
          if (!userId) return;
          const otherOrg = await findOtherTeamOrganization(
            userId,
            invitation.organizationId,
          );
          if (otherOrg) {
            throw new APIError("BAD_REQUEST", {
              message: `${invitation.email} already belongs to another organization (${otherOrg.name}). A user can only be part of one organization.`,
            });
          }
        },
        // Second line of defence at accept time (covers invites created before
        // this guard, or races where the user joined another org meanwhile).
        beforeAcceptInvitation: async ({ invitation, user: acceptingUser }) => {
          const otherOrg = await findOtherTeamOrganization(
            acceptingUser.id,
            invitation.organizationId,
          );
          if (otherOrg) {
            throw new APIError("BAD_REQUEST", {
              message: `You already belong to ${otherOrg.name}. A user can only be part of one organization.`,
            });
          }
        },
        // Give every newly-joined member their default monthly AI allowance.
        afterAcceptInvitation: async ({ member }) => {
          await onMemberJoined(member);
        },
        afterAddMember: async ({ member }) => {
          await onMemberJoined(member);
        },
      },
    }),
    // Hands a browser sign-in to the desktop app (/desktop/auth/complete →
    // keinsaas:// → main-process verify). Server-minted only, hashed at rest,
    // single use; see lib/auth/desktop-handoff.ts.
    oneTimeToken({
      expiresIn: 5,
      storeToken: "hashed",
      disableClientRequest: true,
    }),
    // Bearer keys for the Navigator MCP server (/api/navigator-mcp). Hashed at
    // rest, shown once. A key never stands in for a session elsewhere in the
    // app (`enableSessionForAPIKeys` stays off): the MCP route verifies it and
    // re-checks the org membership in `metadata.organizationId` itself, see
    // lib/navigator-tools/api-keys.ts.
    apiKey({
      defaultPrefix: "nav_",
      enableMetadata: true,
      requireName: true,
      maximumNameLength: 64,
      enableSessionForAPIKeys: false,
      // The plugin default (10 per day) would break the first chat: an MCP
      // client sends several requests per tool call. Its window restarts only
      // after a quiet gap of `timeWindow`, so this allows bursts of 60 calls
      // and then a ten-second pause, rather than a fixed per-minute quota.
      rateLimit: { enabled: true, timeWindow: 10 * 1000, maxRequests: 60 },
      keyExpiration: { defaultExpiresIn: null, maxExpiresIn: 365 },
    }),
    nextCookies(),
  ],
  baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_BASE_URL,
  user: {
    changeEmail: {
      enabled: true,
    },
    deleteUser: {
      enabled: true,
    },
  },
  database: drizzleAdapter(pgDb, {
    provider: "pg",
    schema: {
      user: UserTable,
      session: SessionTable,
      account: AccountTable,
      verification: VerificationTable,
      organization: OrganizationTable,
      member: MemberTable,
      invitation: InvitationTable,
      apikey: ApiKeyTable,
    },
  }),
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          try {
            const activeOrgId = await resolveDefaultActiveOrganizationId(
              session.userId,
            );
            if (!activeOrgId) return { data: session };

            return {
              data: {
                ...session,
                activeOrganizationId: activeOrgId,
              },
            };
          } catch (error) {
            logger.warn("Could not auto-set active organization:", error);
            return { data: session };
          }
        },
        after: async (session) => {
          if (session.activeOrganizationId) return;

          try {
            let activeOrgId = await resolveDefaultActiveOrganizationId(
              session.userId,
            );

            // No membership at all means sign-up's personal-workspace creation
            // never landed — it races the signup session and its failure is
            // swallowed. Repair it here rather than leaving the account
            // workspace-less (and billing to a bare user id) for good.
            if (!activeOrgId) {
              const [user] = await pgDb
                .select({
                  id: UserTable.id,
                  name: UserTable.name,
                  email: UserTable.email,
                })
                .from(UserTable)
                .where(eq(UserTable.id, session.userId))
                .limit(1);
              if (!user) return;

              logger.warn(
                `User ${session.userId} signed in with no organization - creating their personal workspace`,
              );
              await createPersonalOrganization(user);
              activeOrgId = await resolveDefaultActiveOrganizationId(
                session.userId,
              );
              if (!activeOrgId) return;
            }

            await pgDb
              .update(SessionTable)
              .set({ activeOrganizationId: activeOrgId })
              .where(eq(SessionTable.id, session.id));
          } catch (error) {
            logger.warn(
              "Could not backfill active organization on session:",
              error,
            );
          }
        },
      },
    },
    user: {
      create: {
        before: async (user) => {
          // This hook ONLY runs during user creation (sign-up), not on sign-in
          // Use our optimized getIsFirstUser function with caching
          const isFirstUser = await getIsFirstUser();

          // Set role based on whether this is the first user
          const role = isFirstUser ? USER_ROLES.ADMIN : DEFAULT_USER_ROLE;

          logger.info(
            `User creation hook: ${user.email} will get role: ${role} (isFirstUser: ${isFirstUser})`,
          );

          return {
            data: {
              ...user,
              role,
            },
          };
        },
        after: async (user) => {
          // Create personal organization first so it exists before the signup
          // session is created (session.create.before reads memberships).
          //
          // Invited users get one too. Skipping it used to leave a user who
          // declined (or never got to) their invitation with no workspace at
          // all. It does not violate the "one organization per user" rule: the
          // guard counts *team* orgs only and always skips personal ones
          // (see findOtherTeamOrganization).
          try {
            await createPersonalOrganization(user);

            logger.info(`Personal organization created for user ${user.id}`);
          } catch (error) {
            // Don't fail user creation if org creation fails
            logger.error(
              `Failed to create personal org for user ${user.id}:`,
              error,
            );
          }

          // Edition-specific account side effects (CRM sync in the cloud).
          try {
            const { onUserCreated } = await import("@/lib/gate");
            await onUserCreated({
              email: user.email,
              name: user.name,
              id: user.id,
            });
          } catch (error) {
            logger.error("Failed to run account-created hooks:", {
              error,
              userId: user.id,
              email: user.email,
            });
          }

          // Seed preset agents for the new user
          try {
            const { PRESET_AGENTS } = await import("lib/ai/agent/presets");
            const { seedPresetsForUser } = await import(
              "lib/db/pg/repositories/agent-repository.pg"
            );
            const autoSeedPresets = PRESET_AGENTS.filter((p) => p.autoSeed);
            await seedPresetsForUser(user.id, autoSeedPresets);
            logger.info(
              `Seeded ${autoSeedPresets.length} preset agents for user ${user.id}`,
            );
          } catch (error) {
            logger.error(
              `Failed to seed preset agents for user ${user.id}:`,
              error,
            );
          }
        },
      },
    },
  },
  emailAndPassword: {
    enabled: emailAndPasswordEnabled,
    disableSignUp: !signUpEnabled,
    // Enables self-service password reset. Better Auth generates a
    // token-bearing URL that points back at /reset-password; delivery is
    // edition-specific (graceful no-op when no email provider is configured).
    async sendResetPassword({ user, url }) {
      const { sendPasswordResetEmail } = await import("@/lib/gate");
      await sendPasswordResetEmail({
        email: user.email,
        name: user.name,
        resetUrl: url,
      });
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 60,
    },
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day (every 1 day the session expiration is updated)
  },
  advanced: {
    useSecureCookies:
      process.env.NO_HTTPS == "1"
        ? false
        : process.env.NODE_ENV === "production",
    database: {
      // Use a function instead of "uuid" string so Better Auth always generates
      // UUIDs itself, regardless of the pg adapter's supportsUUIDs flag.
      // When generateId === "uuid" + supportsUUIDs === true (pg provider),
      // Better Auth skips ID generation assuming the DB has DEFAULT gen_random_uuid(),
      // which our schema doesn't have — causing null id inserts on invitation creation.
      generateId: () => crypto.randomUUID(),
    },
  },
  account: {
    accountLinking: {
      trustedProviders: (
        Object.keys(
          socialAuthenticationProviders,
        ) as (keyof typeof socialAuthenticationProviders)[]
      ).filter((key) => socialAuthenticationProviders[key]),
    },
  },
  socialProviders: socialAuthenticationProviders,
} satisfies BetterAuthOptions;

export const auth = betterAuth({
  ...options,
  // The cast keeps the inferred plugin list identical to `options.plugins`.
  // It is accurate rather than convenient: the captcha plugin is pure
  // `onRequest` middleware and contributes no endpoints, schema or `$Infer`
  // types, so nothing about `auth`'s shape depends on it being listed.
  plugins: [
    ...(options.plugins ?? []),
    ...captchaPlugins,
  ] as typeof options.plugins,
});

// Request-memoized: the layout, page, and any server actions that run in the
// same render resolve to a single auth lookup instead of repeating it. cache()
// is scoped to one server request and degrades to a passthrough outside React's
// request scope (seed scripts, plain route handlers), so it is always safe.
export const getSession = cache(async () => {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (!session) {
      logger.error("No session found");
      return null;
    }
    return session;
  } catch (error) {
    // Next signals "this route is dynamic" by throwing from headers() during a
    // static render; that is control flow, not a failed lookup.
    unstable_rethrow(error);
    logger.error("Error getting session:", error);
    return null;
  }
});

// Same request-scoped memoization for the organization lookup. One call fans
// out into seven sequential queries (session, user, organization, invitations,
// members, member users, member), so repeating it per caller dominated cold
// boots. Keyed on organizationId, like every cache() wrapper.
export const getFullOrganization = cache(async (organizationId: string) => {
  return auth.api.getFullOrganization({
    query: { organizationId },
    headers: await headers(),
  });
});

// Cache the first user check to avoid repeated DB queries
let isFirstUserCache: boolean | null = null;

export const getIsFirstUser = async () => {
  // If we already know there's at least one user, return false immediately
  // This in-memory cache prevents any DB calls once we know users exist
  if (isFirstUserCache === false) {
    return false;
  }

  try {
    // Direct database query - simple and reliable
    const userCount = await userRepository.getUserCount();
    const isFirstUser = userCount === 0;

    // Once we have at least one user, cache it permanently in memory
    if (!isFirstUser) {
      isFirstUserCache = false;
    }

    return isFirstUser;
  } catch (error) {
    logger.error("Error checking if first user:", error);
    // Cache as false on error to prevent repeated attempts
    isFirstUserCache = false;
    return false;
  }
};

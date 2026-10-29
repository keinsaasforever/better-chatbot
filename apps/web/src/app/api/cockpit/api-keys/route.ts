import { withAuth } from "auth/route-guard";
import {
  createNavigatorApiKey,
  listNavigatorApiKeys,
  revokeNavigatorApiKey,
} from "lib/navigator-tools/api-keys";
import { isUserMemberOfOrganization } from "lib/organization/members";
import globalLogger from "logger";
import { NextResponse } from "next/server";
import { z } from "zod";

const logger = globalLogger.withDefaults({ message: "Cockpit API keys: " });

/**
 * Navigator API keys for the MCP endpoint (`/api/navigator-mcp`).
 *
 * GET lists the caller's keys (never the secrets), POST mints one scoped to
 * the active organization and returns its secret exactly once, DELETE revokes
 * one of the caller's own keys. A user can only ever see or touch their own.
 */

const CreateKeySchema = z.object({
  name: z.string().trim().min(1).max(64),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

const DeleteKeySchema = z.object({ id: z.string().uuid() });

const NO_STORE = { "Cache-Control": "no-store" };

function activeOrganizationOf(session: { session?: unknown }): string | null {
  return (
    (session.session as { activeOrganizationId?: string | null } | undefined)
      ?.activeOrganizationId ?? null
  );
}

export const GET = withAuth(async (_request, session) => {
  try {
    const keys = await listNavigatorApiKeys(session.user.id);
    return NextResponse.json({ keys }, { headers: NO_STORE });
  } catch (error) {
    logger.error("List failed:", error);
    return NextResponse.json(
      { error: "Failed to list API keys" },
      { status: 500 },
    );
  }
});

export const POST = withAuth(async (request, session) => {
  const parsed = CreateKeySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid API key request" },
      { status: 400 },
    );
  }

  try {
    // The key acts in the organization that is active now. The session value
    // is a UI cache, so membership is checked rather than trusted; the MCP
    // route checks it again on every use.
    const organizationId = activeOrganizationOf(session);
    if (
      organizationId &&
      !(await isUserMemberOfOrganization(organizationId, session.user.id))
    ) {
      return NextResponse.json(
        { error: "The active organization is not accessible" },
        { status: 403 },
      );
    }

    const created = await createNavigatorApiKey({
      userId: session.user.id,
      organizationId,
      name: parsed.data.name,
      expiresInDays: parsed.data.expiresInDays,
    });
    return NextResponse.json(
      { key: created },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    logger.error("Create failed:", error);
    return NextResponse.json(
      { error: "Failed to create API key" },
      { status: 500 },
    );
  }
});

export const DELETE = withAuth(async (request, session) => {
  const parsed = DeleteKeySchema.safeParse({
    id: new URL(request.url).searchParams.get("id"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid API key id" }, { status: 400 });
  }

  try {
    const revoked = await revokeNavigatorApiKey(
      session.user.id,
      parsed.data.id,
    );
    if (!revoked) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Revoke failed:", error);
    return NextResponse.json(
      { error: "Failed to revoke API key" },
      { status: 500 },
    );
  }
});

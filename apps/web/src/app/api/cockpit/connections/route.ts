import { withAuth } from "auth/route-guard";
import type { AuthSession } from "auth/route-guard";
import {
  describeScopes,
  listConnectionViews,
  removeConnection,
  resolveCockpitAccess,
  saveConnection,
} from "lib/cockpit/connections";
import { COCKPIT_PROVIDERS } from "lib/cockpit/types";
import { isSecretBoxAvailable } from "lib/crypto/secret-box";
import logger from "logger";
import { NextResponse } from "next/server";
import { z } from "zod";

const SaveSchema = z.object({
  provider: z.enum(COCKPIT_PROVIDERS),
  config: z.record(z.string(), z.unknown()),
  label: z.string().trim().max(80).nullish(),
  enabled: z.boolean().optional(),
});

const scopeOf = (session: AuthSession) => ({
  userId: session.user.id,
  organizationId: session.session.activeOrganizationId ?? null,
});

const forbidden = () =>
  NextResponse.json({ error: "Forbidden" }, { status: 403 });

/**
 * GET /api/cockpit/connections
 * The scope's connections with secrets redacted to field names.
 */
export const GET = withAuth(async (_request, session) => {
  try {
    const access = await resolveCockpitAccess(scopeOf(session));
    const [connections, scope] = await Promise.all([
      listConnectionViews(access),
      // Advisory only: a failure here must not hide the connections.
      describeScopes(access).catch((error) => {
        logger.warn("[cockpit] scope summary failed", error?.name);
        return null;
      }),
    ]);
    return NextResponse.json({
      connections,
      canManage: access.canManage,
      secretsAvailable: isSecretBoxAvailable(),
      scope,
    });
  } catch (error) {
    logger.error("[cockpit] list connections failed", error);
    return NextResponse.json(
      { error: "Failed to load connections" },
      { status: 500 },
    );
  }
});

/**
 * POST /api/cockpit/connections { provider, config, label?, enabled? }
 * Creates or replaces the scope's connection for a provider. Blank secret
 * fields keep the stored value.
 */
export const POST = withAuth(async (request, session) => {
  const body = SaveSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const access = await resolveCockpitAccess(scopeOf(session));
    if (!access.canManage) return forbidden();
    const result = await saveConnection(access, body.data);
    if (!result.ok) {
      return NextResponse.json(
        {
          error: "Connection not saved",
          reason: result.reason,
          issues: result.issues,
        },
        { status: result.status },
      );
    }
    return NextResponse.json({ connection: result.connection });
  } catch (error) {
    logger.error("[cockpit] save connection failed", error);
    return NextResponse.json(
      { error: "Failed to save connection" },
      { status: 500 },
    );
  }
});

/** DELETE /api/cockpit/connections?id=<uuid> */
export const DELETE = withAuth(async (request, session) => {
  const id = z
    .string()
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const access = await resolveCockpitAccess(scopeOf(session));
    if (!access.canManage) return forbidden();
    const removed = await removeConnection(access, id.data);
    if (!removed) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("[cockpit] remove connection failed", error);
    return NextResponse.json(
      { error: "Failed to remove connection" },
      { status: 500 },
    );
  }
});

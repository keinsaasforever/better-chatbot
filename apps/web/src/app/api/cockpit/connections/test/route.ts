import { NextResponse } from "next/server";
import { z } from "zod";
import { type AuthSession, withAuth } from "auth/route-guard";
import { resolveCockpitAccess, testConnection } from "lib/cockpit/connections";
import { COCKPIT_PROVIDERS } from "lib/cockpit/types";
import logger from "logger";

const TestSchema = z.union([
  z.object({ id: z.string().uuid() }),
  z.object({
    provider: z.enum(COCKPIT_PROVIDERS),
    config: z.record(z.string(), z.unknown()),
  }),
]);

const scopeOf = (session: AuthSession) => ({
  userId: session.user.id,
  organizationId: session.session.activeOrganizationId ?? null,
});

/**
 * POST /api/cockpit/connections/test { id } | { provider, config }
 * Runs the provider's probe and returns `{ ok, detail }`, where `detail` is
 * a reason code (never a provider response body). Nothing is saved.
 */
export const POST = withAuth(async (request, session) => {
  const body = TestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const access = await resolveCockpitAccess(scopeOf(session));
    // A probe spends stored credentials on outbound calls: managers only.
    if (!access.canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const result = await testConnection(access, body.data);
    return NextResponse.json(
      { ok: result.ok, detail: result.ok ? null : result.reason },
      { status: result.ok ? 200 : (result.status ?? 200) },
    );
  } catch (error) {
    logger.error("[cockpit] test connection failed", error);
    return NextResponse.json(
      { error: "Failed to test connection" },
      { status: 500 },
    );
  }
});

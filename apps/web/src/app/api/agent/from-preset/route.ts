import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { PRESET_AGENTS } from "lib/ai/agent/presets";
import { seedPresetsForUser } from "lib/db/pg/repositories/agent-repository.pg";
import { pgDb as db } from "lib/db/pg/db.pg";
import { AgentTable } from "lib/db/pg/schema.pg";
import { and, eq } from "drizzle-orm";

/**
 * POST /api/agent/from-preset
 * Body: { presetId: string }
 *
 * Adds a library preset to the user's agents (idempotent).
 * Returns { agentId } of the existing or newly created agent.
 */
export const POST = withAuth(async (req, session) => {
  const { presetId } = await req.json();
  if (!presetId || typeof presetId !== "string") {
    return NextResponse.json(
      { error: "presetId is required" },
      { status: 400 },
    );
  }

  const preset = PRESET_AGENTS.find((p) => p.presetId === presetId);
  if (!preset) {
    return NextResponse.json({ error: "Unknown preset" }, { status: 404 });
  }

  // Check if user already has this preset
  const [existing] = await db
    .select({ id: AgentTable.id })
    .from(AgentTable)
    .where(
      and(
        eq(AgentTable.userId, session.user.id),
        eq(AgentTable.presetId, presetId),
      ),
    );

  if (existing) {
    return NextResponse.json({ agentId: existing.id });
  }

  // Seed the single preset for this user
  await seedPresetsForUser(session.user.id, [preset]);

  // Retrieve the newly created agent id
  const [created] = await db
    .select({ id: AgentTable.id })
    .from(AgentTable)
    .where(
      and(
        eq(AgentTable.userId, session.user.id),
        eq(AgentTable.presetId, presetId),
      ),
    );

  return NextResponse.json({ agentId: created.id });
});

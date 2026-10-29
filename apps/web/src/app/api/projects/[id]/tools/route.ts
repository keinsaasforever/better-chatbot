import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { composio } from "@/lib/composio/client";
import { resolveComposioAccount } from "@/lib/composio/toolkit-connections";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  McpServerTable,
  ProjectConnectedToolTable,
} from "@/lib/db/pg/schema.pg";
import { isReadOnlyComposioAction } from "@/lib/project-brain/run-source";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";

const AttachToolSchema = z.discriminatedUnion("providerType", [
  z.object({
    providerType: z.literal("composio"),
    providerRef: z.string().min(1),
    // Composio connected-account id. Optional: right after OAuth the client may
    // not know it yet, so the server falls back to the newest active account.
    connectionRef: z.string().min(1).optional(),
    displayName: z.string().min(1).max(120),
  }),
  z.object({
    providerType: z.literal("mcp"),
    providerRef: z.string().uuid(),
    connectionRef: z.string().uuid(),
    displayName: z.string().min(1).max(120),
  }),
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    await requireProjectAccess({ projectId });

    const tools = await pgDb
      .select()
      .from(ProjectConnectedToolTable)
      .where(eq(ProjectConnectedToolTable.projectId, projectId))
      .orderBy(desc(ProjectConnectedToolTable.createdAt));

    return NextResponse.json({ tools });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    const { actor } = await requireProjectAccess({
      projectId,
      minRole: "editor",
    });
    const parsed = AttachToolSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_connector",
            message: parsed.error.issues[0]?.message ?? "Invalid connector.",
          },
        },
        { status: 400 },
      );
    }

    const data = parsed.data;
    let readActionSlugs: string[] | undefined;
    let providerRef = data.providerRef;
    let connectionRef: string;

    if (data.providerType === "composio") {
      providerRef = data.providerRef.toLowerCase();
      const accounts = await composio.connectedAccounts.list({
        userIds: [actor.userId],
        toolkitSlugs: [providerRef],
        statuses: ["ACTIVE"],
        // Include org/shared accounts so attaching them doesn't 422.
        accountType: "ALL",
        limit: 100,
      });

      const account = resolveComposioAccount(
        accounts.items,
        providerRef,
        data.connectionRef,
      );

      if (!account) {
        return NextResponse.json(
          {
            error: {
              code: "connection_not_active",
              message: "The selected connected account is not active.",
            },
          },
          { status: 422 },
        );
      }

      connectionRef = account.id;

      const discovered = (await composio.tools.get(
        actor.userId,
        { toolkits: [providerRef] },
        {
          signal: AbortSignal.timeout(20_000),
          beforeExecute: ({ params }) => ({
            ...params,
            connectedAccountId: account.id,
          }),
        },
      )) as Record<string, unknown>;

      readActionSlugs = Object.keys(discovered).filter(
        isReadOnlyComposioAction,
      );

      if (!readActionSlugs.length) {
        return NextResponse.json(
          {
            error: {
              code: "no_read_actions",
              message: "The connector exposes no supported read actions.",
            },
          },
          { status: 422 },
        );
      }
    } else {
      const [server] = await pgDb
        .select({ id: McpServerTable.id })
        .from(McpServerTable)
        .where(
          and(
            eq(McpServerTable.id, data.connectionRef),
            eq(McpServerTable.userId, actor.userId),
          ),
        )
        .limit(1);

      if (!server) {
        return NextResponse.json(
          {
            error: {
              code: "mcp_not_found",
              message: "MCP server not found.",
            },
          },
          { status: 404 },
        );
      }

      providerRef = server.id;
      connectionRef = server.id;
    }

    const [tool] = await pgDb
      .insert(ProjectConnectedToolTable)
      .values({
        projectId,
        credentialOwnerUserId: actor.userId,
        providerType: data.providerType,
        providerRef,
        connectionRef,
        toolName: providerRef,
        displayName: data.displayName,
        status: "connected",
        syncConfig: { readActionSlugs },
      })
      .onConflictDoUpdate({
        target: [
          ProjectConnectedToolTable.projectId,
          ProjectConnectedToolTable.providerType,
          ProjectConnectedToolTable.connectionRef,
          ProjectConnectedToolTable.toolName,
        ],
        set: {
          credentialOwnerUserId: actor.userId,
          displayName: data.displayName,
          status: "connected",
          syncConfig: { readActionSlugs },
          lastSyncError: null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return NextResponse.json({ tool }, { status: 201 });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}

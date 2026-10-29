import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  attentionItems,
  type CockpitToolData,
  getCockpitToolData,
  summaryView,
} from "lib/cockpit/data";
import {
  COCKPIT_UPDATE_TYPES,
  cockpitUpdateType,
  parseCockpitUpdateSeverity,
} from "lib/cockpit/updates";
import { pgDb } from "lib/db/pg/db.pg";
import { NotificationTable } from "lib/db/pg/schema.pg";
import { createNotifications } from "lib/notifications/create-notifications";
import {
  cockpitFinanceSpec,
  cockpitListUpdatesSpec,
  cockpitMarketingSpec,
  cockpitProductHealthSpec,
  cockpitPushUpdateSpec,
  cockpitSeoSpec,
  cockpitSummarySpec,
} from "../definitions";
import type { ToolActor } from "../types";
import { defineTool } from "../types";

function scopeOf(actor: ToolActor) {
  return { userId: actor.userId, organizationId: actor.organizationId };
}

/**
 * All four feeds plus what needs attention first. INOP stays INOP with its
 * reason, so the copilot names the missing source instead of estimating.
 */
function summarize(view: CockpitToolData) {
  const live = Object.values(view).some((feed) => feed.status === "live");
  return {
    ...summaryView(view),
    attention: attentionItems(view),
    note: live
      ? undefined
      : "No cockpit source is connected yet, so there are no numbers to report. Say so plainly; do not estimate. Sources are connected under CONNECT on the cockpit.",
  };
}

export const cockpitSummaryTool = defineTool(
  cockpitSummarySpec,
  async (actor) => summarize(await getCockpitToolData(scopeOf(actor))),
);

export const cockpitFinanceTool = defineTool(
  cockpitFinanceSpec,
  async (actor) => ({
    finance: (await getCockpitToolData(scopeOf(actor))).finance,
  }),
);

export const cockpitMarketingTool = defineTool(
  cockpitMarketingSpec,
  async (actor) => ({
    marketing: (await getCockpitToolData(scopeOf(actor))).marketing,
  }),
);

export const cockpitProductHealthTool = defineTool(
  cockpitProductHealthSpec,
  async (actor) => ({
    productHealth: (await getCockpitToolData(scopeOf(actor))).productHealth,
  }),
);

export const cockpitSeoTool = defineTool(cockpitSeoSpec, async (actor) => ({
  seo: (await getCockpitToolData(scopeOf(actor))).seo,
}));

/** Same line within the same minute is one row: a replayed call stays silent. */
function updateDedupeKey(input: {
  title: string;
  body?: string;
  url?: string;
}): string {
  const digest = createHash("sha256")
    .update(`${input.title}\n${input.body ?? ""}\n${input.url ?? ""}`)
    .digest("hex")
    .slice(0, 24);
  return `cockpit:${digest}:${Math.floor(Date.now() / 60_000)}`;
}

export const cockpitPushUpdateTool = defineTool(
  cockpitPushUpdateSpec,
  async (actor, args) => {
    // The UPDATES display is the caller's own: rows are written for the actor
    // only, never fanned out to an organization.
    const { inserted } = await createNotifications({
      userIds: [actor.userId],
      type: cockpitUpdateType(args.severity),
      title: args.title,
      body: args.body ?? null,
      url: args.url ?? null,
      dedupeKey: updateDedupeKey(args),
      push: { kind: "cockpit" },
    });
    return {
      posted: inserted.length > 0,
      ...(inserted.length ? { id: inserted[0].id } : { duplicate: true }),
      severity: args.severity,
    };
  },
);

export const cockpitListUpdatesTool = defineTool(
  cockpitListUpdatesSpec,
  async (actor, args) => {
    const rows = await pgDb
      .select({
        id: NotificationTable.id,
        type: NotificationTable.type,
        title: NotificationTable.title,
        body: NotificationTable.body,
        url: NotificationTable.url,
        readAt: NotificationTable.readAt,
        createdAt: NotificationTable.createdAt,
      })
      .from(NotificationTable)
      .where(
        and(
          eq(NotificationTable.userId, actor.userId),
          inArray(NotificationTable.type, [...COCKPIT_UPDATE_TYPES]),
        ),
      )
      .orderBy(desc(NotificationTable.createdAt))
      .limit(args.limit ?? 8);

    return {
      updates: rows.map((row) => ({
        id: row.id,
        severity: parseCockpitUpdateSeverity(row.type) ?? "info",
        title: row.title,
        body: row.body,
        url: row.url,
        read: row.readAt != null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  },
);

export const COCKPIT_TOOLS = [
  cockpitSummaryTool,
  cockpitFinanceTool,
  cockpitMarketingTool,
  cockpitProductHealthTool,
  cockpitSeoTool,
  cockpitPushUpdateTool,
  cockpitListUpdatesTool,
];

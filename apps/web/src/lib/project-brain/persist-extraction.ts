import "server-only";

import { createHash } from "node:crypto";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectBrainAliasTable,
  ProjectBrainFactTable,
  ProjectBrainLinkEvidenceTable,
  ProjectBrainPageTable,
  ProjectBrainPageVersionTable,
  ProjectBrainRawSourceTable,
  ProjectTable,
} from "@/lib/db/pg/schema.pg";
import { pgArray } from "@/lib/db/pg/sql-array";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { type AliasCandidate, matchAlias } from "./alias-match";
import type { ProjectBrainExtraction } from "./extraction-schema";
import { upsertLinkWithEvidence } from "./link-evidence";
import { type MentionAlias, findMentions } from "./mention-links";
import { pageSlug } from "./slug";
import { replaceProjectBrainTimeline } from "./timeline-events";

function normalizeAlias(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/**
 * Second chance after the exact alias lookup missed: people and organizations
 * whose aliases are trigram-close, or whose email / domain matches, resolve to
 * the existing page (see alias-match.ts for the rules). Ambiguity yields no
 * match and a new page; the nightly dedupe reviews those with a model.
 */
async function resolveFuzzyPage(
  tx: any,
  input: {
    projectId: string;
    entity: ProjectBrainExtraction["entities"][number];
  },
  normalizedAliases: string[],
): Promise<string | undefined> {
  const type = input.entity.type;
  if (type !== "person" && type !== "organization") return undefined;

  const metadata = input.entity.metadata ?? {};
  const email = typeof metadata.email === "string" ? metadata.email : null;
  const domain =
    typeof metadata.domain === "string"
      ? metadata.domain
      : typeof metadata.website === "string"
        ? metadata.website
        : null;

  const rows = (await tx.execute(sql`
    SELECT a.page_id AS "pageId",
           a.normalized_alias AS "normalizedAlias",
           p.frontmatter->>'email' AS email,
           COALESCE(p.frontmatter->>'domain', p.frontmatter->>'website') AS domain
    FROM project_brain_alias a
    JOIN project_brain_page p ON p.id = a.page_id
    WHERE a.project_id = ${input.projectId}
      AND a.entity_type = ${type}
      AND p.archived_at IS NULL
      AND (
        ${email ? sql`lower(p.frontmatter->>'email') = ${email.toLowerCase()} OR` : sql``}
        EXISTS (
          SELECT 1 FROM unnest(${pgArray(normalizedAliases, "text")}) AS q(alias)
          WHERE similarity(a.normalized_alias, q.alias) > 0.3
        )
      )
    LIMIT 25
  `)) as AliasCandidate[];

  return matchAlias(
    {
      entityType: type,
      title: input.entity.title,
      aliases: input.entity.aliases,
      email,
      domain,
    },
    rows,
  )?.pageId;
}

async function resolveOrCreatePage(
  tx: any,
  input: {
    projectId: string;
    userId: string;
    sourceId: string;
    entity: ProjectBrainExtraction["entities"][number];
  },
): Promise<string> {
  const aliases = [...new Set([input.entity.title, ...input.entity.aliases])];
  const normalizedAliases = aliases.map(normalizeAlias).filter(Boolean);

  const matches = await tx
    .select({ pageId: ProjectBrainAliasTable.pageId })
    .from(ProjectBrainAliasTable)
    .where(
      and(
        eq(ProjectBrainAliasTable.projectId, input.projectId),
        eq(ProjectBrainAliasTable.entityType, input.entity.type),
        inArray(ProjectBrainAliasTable.normalizedAlias, normalizedAliases),
      ),
    );

  const pageIds: string[] = [
    ...new Set(
      (matches as Array<{ pageId: string }>).map((match) => match.pageId),
    ),
  ];
  if (pageIds.length > 1) {
    throw new Error(`brain_alias_collision:${input.entity.title}`);
  }

  let pageId: string | undefined = pageIds[0];
  if (!pageId) {
    pageId = await resolveFuzzyPage(tx, input, normalizedAliases);
  }
  if (!pageId) {
    const [page] = await tx
      .insert(ProjectBrainPageTable)
      .values({
        projectId: input.projectId,
        userId: input.userId,
        slug: pageSlug(input.entity.type, input.entity.title),
        type: input.entity.type,
        title: input.entity.title,
        compiledTruth: "",
        summary: input.entity.summary,
        frontmatter: input.entity.metadata,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [ProjectBrainPageTable.projectId, ProjectBrainPageTable.slug],
        set: {
          summary: input.entity.summary,
          frontmatter: input.entity.metadata,
          updatedAt: new Date(),
        },
      })
      .returning({ id: ProjectBrainPageTable.id });

    pageId = page?.id;
  }

  if (!pageId) {
    throw new Error(`Could not resolve page for ${input.entity.title}.`);
  }

  await tx
    .insert(ProjectBrainAliasTable)
    .values(
      aliases.map((alias, index) => ({
        projectId: input.projectId,
        pageId,
        entityType: input.entity.type,
        alias,
        normalizedAlias: normalizeAlias(alias),
        source: index === 0 ? "canonical" : "extracted",
        createdBySourceId: input.sourceId,
      })),
    )
    .onConflictDoNothing();

  return pageId;
}

export async function persistProjectBrainExtraction(input: {
  runId: string;
  projectId: string;
  sourceId: string;
  sourceScope: string;
  extraction: ProjectBrainExtraction;
  persistKnowledge: boolean;
}) {
  const [context] = await pgDb
    .select({
      ownerUserId: ProjectTable.ownerUserId,
      observedAt: ProjectBrainRawSourceTable.observedAt,
      rawSourceType: ProjectBrainRawSourceTable.sourceType,
    })
    .from(ProjectBrainRawSourceTable)
    .innerJoin(
      ProjectTable,
      eq(ProjectBrainRawSourceTable.projectId, ProjectTable.id),
    )
    .where(
      and(
        eq(ProjectBrainRawSourceTable.id, input.sourceId),
        eq(ProjectBrainRawSourceTable.projectId, input.projectId),
      ),
    )
    .limit(1);

  if (!context) {
    throw new Error("Project brain source not found.");
  }

  const timelineInput = {
    projectId: input.projectId,
    userId: context.ownerUserId,
    sourceScope: input.sourceScope,
    rawSourceType: context.rawSourceType,
    observedAt: context.observedAt,
    timeline: input.extraction.timeline,
  };

  // Memory off: keep the timeline (it feeds the voice "recent events" tool and
  // the consolidated status) but write no pages, facts or links.
  if (!input.persistKnowledge) {
    await replaceProjectBrainTimeline(pgDb, timelineInput);
    return {
      entities: 0,
      facts: 0,
      relations: 0,
      mentionLinks: 0,
      pageIds: [] as string[],
    };
  }

  return pgDb.transaction(async (tx) => {
    const pageByEntityId = new Map<string, string>();
    const touchedPageIds = new Set<string>();

    for (const entity of input.extraction.entities) {
      const pageId = await resolveOrCreatePage(tx, {
        projectId: input.projectId,
        userId: context.ownerUserId,
        sourceId: input.sourceId,
        entity,
      });

      pageByEntityId.set(entity.id, pageId);
      touchedPageIds.add(pageId);

      for (const fact of entity.facts) {
        const observedAt = fact.observedAt
          ? new Date(fact.observedAt)
          : context.observedAt;
        const valueHash = createHash("sha256")
          .update(fact.value.trim())
          .digest("hex");

        await tx
          .update(ProjectBrainFactTable)
          .set({
            status: "superseded",
            supersededAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ProjectBrainFactTable.pageId, pageId),
              eq(ProjectBrainFactTable.sourceScope, input.sourceScope),
              eq(ProjectBrainFactTable.factKey, fact.key),
              eq(ProjectBrainFactTable.status, "current"),
              ne(ProjectBrainFactTable.valueHash, valueHash),
            ),
          );

        await tx
          .insert(ProjectBrainFactTable)
          .values({
            projectId: input.projectId,
            pageId,
            sourceScope: input.sourceScope,
            factType: fact.type,
            factKey: fact.key,
            value: fact.value,
            valueHash,
            status: "current",
            confidence: String(fact.confidence),
            firstSourceId: input.sourceId,
            lastSourceId: input.sourceId,
            lastRunId: input.runId,
            firstObservedAt: observedAt,
            lastObservedAt: observedAt,
          })
          .onConflictDoUpdate({
            target: [
              ProjectBrainFactTable.pageId,
              ProjectBrainFactTable.sourceScope,
              ProjectBrainFactTable.factKey,
              ProjectBrainFactTable.valueHash,
            ],
            set: {
              status: "current",
              confidence: String(fact.confidence),
              lastSourceId: input.sourceId,
              lastRunId: input.runId,
              lastObservedAt: observedAt,
              supersededAt: null,
              updatedAt: new Date(),
            },
          });
      }
    }

    for (const relation of input.extraction.relations) {
      const fromPageId = pageByEntityId.get(relation.fromEntityId);
      const toPageId = pageByEntityId.get(relation.toEntityId);

      if (!fromPageId || !toPageId) {
        throw new Error("Relation references an unresolved entity.");
      }

      const evidenceKey = createHash("sha256")
        .update(
          [
            relation.type,
            relation.context ?? "",
            relation.fromEntityId,
            relation.toEntityId,
          ].join(":"),
        )
        .digest("hex");

      await upsertLinkWithEvidence(tx, {
        projectId: input.projectId,
        fromPageId,
        toPageId,
        linkType: relation.type,
        context: relation.context,
        confidence: relation.confidence,
        source: "classifier",
        sourceId: input.sourceId,
        runId: input.runId,
        sourceScope: input.sourceScope,
        evidenceKey,
        observedAt: relation.observedAt
          ? new Date(relation.observedAt)
          : context.observedAt,
      });
    }

    const retracted = await tx
      .update(ProjectBrainFactTable)
      .set({ status: "retracted", updatedAt: new Date() })
      .where(
        and(
          eq(ProjectBrainFactTable.projectId, input.projectId),
          eq(ProjectBrainFactTable.sourceScope, input.sourceScope),
          eq(ProjectBrainFactTable.status, "current"),
          ne(ProjectBrainFactTable.lastRunId, input.runId),
        ),
      )
      .returning({ pageId: ProjectBrainFactTable.pageId });

    for (const fact of retracted) {
      touchedPageIds.add(fact.pageId);
    }

    await tx
      .update(ProjectBrainLinkEvidenceTable)
      .set({ status: "retracted" })
      .where(
        and(
          eq(ProjectBrainLinkEvidenceTable.projectId, input.projectId),
          eq(ProjectBrainLinkEvidenceTable.sourceScope, input.sourceScope),
          eq(ProjectBrainLinkEvidenceTable.status, "current"),
          ne(ProjectBrainLinkEvidenceTable.runId, input.runId),
        ),
      );

    // Every alias of the project, for deterministic "mentions" edges below.
    const projectAliases = (await tx
      .select({
        pageId: ProjectBrainAliasTable.pageId,
        normalizedAlias: ProjectBrainAliasTable.normalizedAlias,
      })
      .from(ProjectBrainAliasTable)
      .where(
        eq(ProjectBrainAliasTable.projectId, input.projectId),
      )) as MentionAlias[];

    let mentionLinks = 0;

    for (const pageId of touchedPageIds) {
      const facts = await tx
        .select()
        .from(ProjectBrainFactTable)
        .where(
          and(
            eq(ProjectBrainFactTable.pageId, pageId),
            eq(ProjectBrainFactTable.status, "current"),
          ),
        )
        .orderBy(
          asc(ProjectBrainFactTable.factKey),
          desc(ProjectBrainFactTable.lastObservedAt),
          desc(ProjectBrainFactTable.confidence),
        );

      const winners = new Map<string, (typeof facts)[number]>();
      for (const fact of facts) {
        if (!winners.has(fact.factKey)) {
          winners.set(fact.factKey, fact);
        }
      }

      const compiledTruth = [...winners.values()]
        .map((fact) => `- ${fact.factKey}: ${fact.value}`)
        .join("\n");

      await tx
        .update(ProjectBrainPageTable)
        .set({ compiledTruth, updatedAt: new Date() })
        .where(eq(ProjectBrainPageTable.id, pageId));

      await tx.insert(ProjectBrainPageVersionTable).values({
        projectId: input.projectId,
        pageId,
        sourceId: input.sourceId,
        compiledTruth,
      });

      // gbrain-style self-wiring: a page that names another page of this
      // project gets a `mentions` edge, without any model call.
      const [page] = await tx
        .select({
          title: ProjectBrainPageTable.title,
          summary: ProjectBrainPageTable.summary,
        })
        .from(ProjectBrainPageTable)
        .where(eq(ProjectBrainPageTable.id, pageId))
        .limit(1);
      const mentioned = findMentions({
        text: [page?.title, page?.summary, compiledTruth]
          .filter(Boolean)
          .join("\n"),
        aliases: projectAliases,
        selfPageId: pageId,
      });
      for (const toPageId of mentioned) {
        await upsertLinkWithEvidence(tx, {
          projectId: input.projectId,
          fromPageId: pageId,
          toPageId,
          linkType: "mentions",
          confidence: 0.8,
          source: "markdown",
          sourceId: input.sourceId,
          runId: input.runId,
          sourceScope: input.sourceScope,
          evidenceKey: `mention:${toPageId}`,
          observedAt: context.observedAt,
        });
        mentionLinks++;
      }
    }

    await replaceProjectBrainTimeline(tx, {
      ...timelineInput,
      pageIdByEntityId: pageByEntityId,
    });

    return {
      entities: input.extraction.entities.length,
      facts: input.extraction.entities.reduce(
        (count, entity) => count + entity.facts.length,
        0,
      ),
      relations: input.extraction.relations.length,
      mentionLinks,
      pageIds: [...touchedPageIds],
    };
  });
}

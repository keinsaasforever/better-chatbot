import "server-only";
import { pgDb } from "@/lib/db/pg/db.pg";
import { KnowledgeBaseTable } from "@/lib/db/pg/schema.pg";
import { eq } from "drizzle-orm";
import { getAgentsetClient, getAgentsetNamespace } from "./client";
import { formatAgentsetError } from "./projects";
import { isAgentsetCreatedAtSchemaError } from "./ingest-job-fetch";
import {
  getAgentsetRetrievalMinScore,
  getAgentsetRetrievalRerankLimit,
} from "./retrieval-config";
import {
  readChunkPageNumber,
  readChunkSequenceNumber,
  resolveChunkDocumentIds,
} from "./chunk-metadata";
import { extractFigureUrls } from "@/lib/citations/figure-urls";
import type { RetrievalSource } from "@/lib/citations/retrieval-source";

type NamespaceSchema = Awaited<
  ReturnType<ReturnType<typeof getAgentsetClient>["namespaces"]["get"]>
>;

const kbNamespaceEnsureLocks = new Map<string, Promise<string>>();

/** Stable, unique slug per knowledge base (Agentset max slug length: 48). */
export function buildKnowledgeBaseAgentsetSlug(knowledgeBaseId: string) {
  const id = knowledgeBaseId.trim().toLowerCase();
  const slug = `kb-${id}`;
  return slug.length <= 48 ? slug : `kb-${id.replace(/-/g, "")}`;
}

async function findNamespaceBySlug(slug: string) {
  const agentset = getAgentsetClient();
  let namespaces: NamespaceSchema[];
  try {
    namespaces = await agentset.namespaces.list();
  } catch (error) {
    if (isAgentsetCreatedAtSchemaError(error)) {
      console.warn(
        "[agentset] namespaces.list returned schema 422; skipping list recovery",
        { error: formatAgentsetError(error) },
      );
      return null;
    }
    throw error;
  }
  return namespaces.find((namespace) => namespace.slug === slug) ?? null;
}

async function provisionKnowledgeBaseNamespace(kb: {
  id: string;
  name: string;
}) {
  const agentset = getAgentsetClient();
  const slug = buildKnowledgeBaseAgentsetSlug(kb.id);

  let namespace: NamespaceSchema;
  try {
    namespace = await agentset.namespaces.create({ name: kb.name, slug });
  } catch (error) {
    // Conflict (or races): recover the same-org namespace by slug.
    const recovered = await findNamespaceBySlug(slug);
    if (!recovered) throw error;
    namespace = recovered;
  }

  await pgDb
    .update(KnowledgeBaseTable)
    .set({ agentsetNamespaceId: namespace.id, updatedAt: new Date() })
    .where(eq(KnowledgeBaseTable.id, kb.id));

  return namespace.id;
}

/**
 * Lazily provisions (and persists) the knowledge base's Agentset namespace.
 * Callers are responsible for access checks — this only does plumbing.
 */
export async function ensureKnowledgeBaseNamespace(knowledgeBaseId: string) {
  const [kb] = await pgDb
    .select({
      id: KnowledgeBaseTable.id,
      name: KnowledgeBaseTable.name,
      agentsetNamespaceId: KnowledgeBaseTable.agentsetNamespaceId,
    })
    .from(KnowledgeBaseTable)
    .where(eq(KnowledgeBaseTable.id, knowledgeBaseId))
    .limit(1);

  if (!kb) throw new Error("Knowledge base not found");
  if (kb.agentsetNamespaceId) {
    // Trust the persisted id (see projects.ts for why validation is skipped).
    return getAgentsetNamespace(kb.agentsetNamespaceId);
  }

  const inFlight = kbNamespaceEnsureLocks.get(kb.id);
  if (inFlight) {
    return getAgentsetNamespace(await inFlight);
  }

  const promise = provisionKnowledgeBaseNamespace(kb).finally(() => {
    kbNamespaceEnsureLocks.delete(kb.id);
  });
  kbNamespaceEnsureLocks.set(kb.id, promise);

  return getAgentsetNamespace(await promise);
}

export async function ingestKnowledgeBaseFile(input: {
  knowledgeBaseId: string;
  userId: string;
  file: File;
  filename: string;
  contentType: string;
}) {
  const ns = await ensureKnowledgeBaseNamespace(input.knowledgeBaseId);

  const upload = await ns.uploads.upload({
    file: input.file,
    contentType: input.contentType,
  });

  const job = await ns.ingestion.create({
    name: input.filename,
    payload: {
      type: "MANAGED_FILE",
      key: upload.key,
      fileName: input.filename,
    },
    config: {
      metadata: {
        knowledgeBaseId: input.knowledgeBaseId,
        userId: input.userId,
        filename: input.filename,
        filetype: input.contentType,
        sourceType: "chat_upload",
      },
    },
  });

  return { upload, job };
}

/**
 * Searches a set of already-provisioned namespaces and merges the hits by
 * score. Namespaces that error are skipped — retrieval must never take the
 * chat down.
 */
export async function searchKnowledgeBaseNamespaces(input: {
  namespaceIds: string[];
  query: string;
  limit?: number;
}): Promise<RetrievalSource[]> {
  const limit = input.limit ?? getAgentsetRetrievalRerankLimit();
  if (!input.namespaceIds.length) return [];

  const settled = await Promise.allSettled(
    input.namespaceIds.map((namespaceId) =>
      getAgentsetNamespace(namespaceId).search(input.query, {
        topK: 20,
        rerank: true,
        rerankLimit: limit,
        minScore: getAgentsetRetrievalMinScore(),
        mode: "semantic",
        includeMetadata: true,
      }),
    ),
  );

  const rows = settled.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    console.error("[agentset] knowledge base search failed", {
      namespaceId: input.namespaceIds[index],
      error: formatAgentsetError(result.reason),
    });
    return [];
  });

  return rows
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
    .map((row, index) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      const text = row.text ?? "";
      const { navigatorDocumentId, agentsetDocumentId } =
        resolveChunkDocumentIds(metadata);
      return {
        rank: index + 1,
        content: text,
        source: (metadata.filename as string | undefined) ?? "document",
        similarity: row.score ?? 0,
        documentId: navigatorDocumentId ?? null,
        agentsetDocumentId: agentsetDocumentId ?? null,
        chunkId: row.id ?? null,
        pageNumber: readChunkPageNumber(metadata),
        sequenceNumber: readChunkSequenceNumber(metadata),
        figureUrls: extractFigureUrls(text),
      };
    });
}

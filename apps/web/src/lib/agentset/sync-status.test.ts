import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockIngestionGet = vi.fn();
const mockDocumentsAll = vi.fn();
const mockEnsureNamespace = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();
const mockTrackUsage = vi.fn();

// Mock the seam, not a billing provider: this file has to hold in every
// edition, and the provider behind the seam differs between them.
vi.mock("@/lib/gate", () => ({
  trackUsage: (...args: unknown[]) => mockTrackUsage(...args),
}));

vi.mock("@/lib/agentset/projects", () => ({
  ensureProjectAgentsetNamespace: (...args: unknown[]) =>
    mockEnsureNamespace(...args),
  formatAgentsetError: (error: unknown) =>
    error instanceof Error ? error.message : "Agentset request failed",
}));

const mockSelect = vi.fn();

vi.mock("@/lib/db/pg/db.pg", () => ({
  pgDb: {
    update: (...args: unknown[]) => {
      mockUpdate(...args);
      return {
        set: (...setArgs: unknown[]) => {
          mockSet(...setArgs);
          return {
            where: (...whereArgs: unknown[]) => mockWhere(...whereArgs),
          };
        },
      };
    },
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return {
        from: vi.fn(() => ({
          where: vi.fn(() =>
            Promise.resolve([
              {
                id: "nav-doc-1",
                agentsetIngestJobId: "job_123",
              },
            ]),
          ),
        })),
      };
    },
  },
}));

import {
  syncAgentsetIngestJobStatus,
  syncPendingAgentsetDocumentsForProject,
} from "./sync-status";

describe("syncAgentsetIngestJobStatus", () => {
  beforeEach(() => {
    mockIngestionGet.mockReset();
    mockDocumentsAll.mockReset();
    mockEnsureNamespace.mockReset();
    mockUpdate.mockReset();
    mockSet.mockReset();
    mockWhere.mockReset();
    mockTrackUsage.mockReset().mockResolvedValue(undefined);

    mockEnsureNamespace.mockResolvedValue({
      ingestion: { get: mockIngestionGet },
      documents: { all: mockDocumentsAll },
    });
  });

  it("uses create snapshot on upload without calling ingestion.get", async () => {
    mockDocumentsAll.mockResolvedValue({ documents: [] });

    const result = await syncAgentsetIngestJobStatus({
      documentId: "nav-doc-1",
      projectId: "project-1",
      userId: "user-1",
      ingestJobId: "job_123",
      jobSnapshot: { status: "PENDING" },
    });

    expect(mockIngestionGet).not.toHaveBeenCalled();
    expect(result.status).toBe("pending");
  });

  it("marks completed when document is done but job is still processing", async () => {
    mockIngestionGet.mockResolvedValue({
      status: "PROCESSING",
    });
    mockDocumentsAll.mockResolvedValue({
      documents: [
        {
          id: "doc_123",
          status: "COMPLETED",
        },
      ],
    });

    const result = await syncAgentsetIngestJobStatus({
      documentId: "nav-doc-1",
      projectId: "project-1",
      userId: "user-1",
      ingestJobId: "job_123",
    });

    expect(result.status).toBe("completed");
    expect(result.agentsetDocumentId).toBe("doc_123");
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        agentsetStatus: "completed",
        agentsetDocumentId: "doc_123",
      }),
    );
  });

  it("falls back to documents when ingestion.get is unavailable", async () => {
    mockIngestionGet.mockRejectedValue(
      new Error(
        "invalid_type: createdAt: Invalid input: expected date, received string",
      ),
    );
    mockDocumentsAll.mockResolvedValue({
      documents: [
        {
          id: "doc_123",
          status: "COMPLETED",
        },
      ],
    });

    const result = await syncAgentsetIngestJobStatus({
      documentId: "nav-doc-1",
      projectId: "project-1",
      userId: "user-1",
      ingestJobId: "job_123",
    });

    expect(result.status).toBe("completed");
    expect(result.job).toBeNull();
  });

  it("reports parsed characters before marking a new document completed", async () => {
    mockIngestionGet.mockResolvedValue({ status: "PROCESSING" });
    mockDocumentsAll.mockResolvedValue({
      documents: [
        {
          id: "doc_123",
          status: "COMPLETED",
          totalCharacters: 1_001,
          config: {
            metadata: {
              billingCustomerId: "org_1",
              billingEntityId: "user_1",
              sourceType: "project_upload",
            },
          },
        },
      ],
    });

    await syncAgentsetIngestJobStatus({
      documentId: "nav-doc-1",
      projectId: "project-1",
      userId: "user-1",
      ingestJobId: "job_123",
    });

    expect(mockTrackUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "agentset",
        customerId: "org_1",
        entityId: "user_1",
        parsedPages: 2,
        idempotencyKey: "agentset:doc_123",
      }),
    );
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ agentsetStatus: "completed" }),
    );
  });

  it("leaves the document retryable when usage reporting fails", async () => {
    mockIngestionGet.mockResolvedValue({ status: "PROCESSING" });
    mockDocumentsAll.mockResolvedValue({
      documents: [
        {
          id: "doc_123",
          status: "COMPLETED",
          totalCharacters: 1_000,
          config: {
            metadata: {
              billingCustomerId: "org_1",
              billingEntityId: "user_1",
            },
          },
        },
      ],
    });
    mockTrackUsage.mockRejectedValue(new Error("usage reporting unavailable"));

    await expect(
      syncAgentsetIngestJobStatus({
        documentId: "nav-doc-1",
        projectId: "project-1",
        userId: "user-1",
        ingestJobId: "job_123",
      }),
    ).rejects.toThrow("Agentset usage billing could not be synchronized");
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("marks failed when sync API errors during pending sync", async () => {
    mockEnsureNamespace.mockRejectedValue(new Error("Unauthorized namespace"));

    await syncPendingAgentsetDocumentsForProject({
      projectId: "project-1",
      userId: "user-1",
    });

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        agentsetStatus: "failed",
        agentsetError: "Unauthorized namespace",
      }),
    );
  });
});

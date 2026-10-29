import { describe, expect, it, vi, beforeEach } from "vitest";
import { NotFoundError, UnprocessableEntityError } from "agentset";

vi.mock("server-only", () => ({}));

const mockDocumentsDelete = vi.fn();
const mockNamespacesDelete = vi.fn();

vi.mock("@/lib/agentset/client", () => ({
  getAgentsetClient: () => ({
    namespaces: { delete: mockNamespacesDelete },
  }),
  getAgentsetNamespace: () => ({
    documents: { delete: mockDocumentsDelete },
  }),
}));

import { deleteAgentsetDocument, deleteAgentsetNamespace } from "./deletion";

describe("deleteAgentsetDocument", () => {
  beforeEach(() => {
    mockDocumentsDelete.mockReset();
  });

  it("returns deleted when the API succeeds", async () => {
    mockDocumentsDelete.mockResolvedValue(undefined);

    const result = await deleteAgentsetDocument({
      namespaceId: "ns_1",
      agentsetDocumentId: "doc_1",
    });

    expect(result.deleted).toBe(true);
    expect(mockDocumentsDelete).toHaveBeenCalledWith("doc_1");
  });

  it("treats 404 as already gone", async () => {
    mockDocumentsDelete.mockRejectedValue(new NotFoundError("missing"));

    const result = await deleteAgentsetDocument({
      namespaceId: "ns_1",
      agentsetDocumentId: "doc_1",
    });

    expect(result.deleted).toBe(false);
  });

  it("treats Agentset createdAt 422 as already gone", async () => {
    mockDocumentsDelete.mockRejectedValue(
      new UnprocessableEntityError(
        "invalid_type: createdAt: Invalid input: expected date, received string",
      ),
    );

    const result = await deleteAgentsetDocument({
      namespaceId: "ns_1",
      agentsetDocumentId: "doc_1",
    });

    expect(result.deleted).toBe(false);
  });

  it("rethrows other errors", async () => {
    mockDocumentsDelete.mockRejectedValue(new Error("Internal error"));

    await expect(
      deleteAgentsetDocument({
        namespaceId: "ns_1",
        agentsetDocumentId: "doc_1",
      }),
    ).rejects.toThrow("Internal error");
  });
});

describe("deleteAgentsetNamespace", () => {
  beforeEach(() => {
    mockNamespacesDelete.mockReset();
  });

  it("deletes the namespace via the SDK", async () => {
    mockNamespacesDelete.mockResolvedValue(undefined);

    const result = await deleteAgentsetNamespace({ namespaceId: "ns_1" });

    expect(result.deleted).toBe(true);
    expect(mockNamespacesDelete).toHaveBeenCalledWith("ns_1");
  });

  it("treats 404 as already gone", async () => {
    mockNamespacesDelete.mockRejectedValue(new NotFoundError("missing"));

    const result = await deleteAgentsetNamespace({ namespaceId: "ns_1" });

    expect(result.deleted).toBe(false);
  });

  it("treats Agentset createdAt 422 as already gone", async () => {
    mockNamespacesDelete.mockRejectedValue(
      new UnprocessableEntityError(
        "invalid_type: createdAt: Invalid input: expected date, received string",
      ),
    );

    const result = await deleteAgentsetNamespace({ namespaceId: "ns_1" });

    expect(result.deleted).toBe(false);
  });
});

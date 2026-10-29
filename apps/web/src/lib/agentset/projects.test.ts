import { describe, expect, it, vi, beforeEach } from "vitest";
import { UnprocessableEntityError } from "agentset";

vi.mock("server-only", () => ({}));

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockGet = vi.fn();

let persistedNamespaceId: string | null = null;

vi.mock("@/lib/agentset/client", () => ({
  getAgentsetClient: () => ({
    namespaces: {
      list: mockList,
      create: mockCreate,
      get: mockGet,
    },
  }),
  getAgentsetNamespace: (id: string) => ({ id }),
}));

vi.mock("@/lib/db/pg/db.pg", () => ({
  pgDb: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() =>
            Promise.resolve([
              {
                id: "project-1",
                name: "Test",
                agentsetNamespaceId: persistedNamespaceId,
              },
            ]),
          ),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  },
}));

import {
  createProjectAgentsetNamespace,
  ensureProjectAgentsetNamespace,
} from "./projects";

describe("createProjectAgentsetNamespace", () => {
  beforeEach(() => {
    persistedNamespaceId = null;
    mockList.mockReset();
    mockCreate.mockReset();
    mockGet.mockReset();
  });

  it("creates namespace when none exists in org", async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({
      id: "ns_new",
      slug: "project-abc",
      name: "Test",
    });

    const namespace = await createProjectAgentsetNamespace({
      projectId: "abc-def-1234-5678-90ab-cdef12345678",
      userId: "user-1",
      projectName: "Test",
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(namespace.id).toBe("ns_new");
  });

  it("links existing namespace from org list without calling create", async () => {
    mockList.mockResolvedValue([
      {
        id: "ns_existing",
        slug: "project-abc-def-1234-5678-90ab-cdef12345678",
        name: "Old Test",
      },
    ]);

    const namespace = await createProjectAgentsetNamespace({
      projectId: "abc-def-1234-5678-90ab-cdef12345678",
      userId: "user-1",
      projectName: "Test",
    });

    expect(mockCreate).not.toHaveBeenCalled();
    expect(namespace.id).toBe("ns_existing");
  });

  it("falls back to create when namespaces.list returns the createdAt schema 422", async () => {
    mockList.mockRejectedValue(
      new UnprocessableEntityError(
        "invalid_type: createdAt: Invalid input: expected date, received string",
      ),
    );
    mockCreate.mockResolvedValue({
      id: "ns_after_422",
      slug: "project-abc",
      name: "Test",
    });

    const namespace = await createProjectAgentsetNamespace({
      projectId: "abc-def-1234-5678-90ab-cdef12345678",
      userId: "user-1",
      projectName: "Test",
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(namespace.id).toBe("ns_after_422");
  });
});

describe("ensureProjectAgentsetNamespace", () => {
  beforeEach(() => {
    persistedNamespaceId = null;
    mockList.mockReset();
    mockCreate.mockReset();
    mockGet.mockReset();
  });

  it("trusts the persisted namespace id without validating via namespaces.get", async () => {
    persistedNamespaceId = "ns_persisted";

    const namespace = await ensureProjectAgentsetNamespace({
      projectId: "project-1",
      userId: "user-1",
    });

    expect(mockGet).not.toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(namespace).toEqual({ id: "ns_persisted" });
  });
});

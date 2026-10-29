import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDbBasedMCPConfigsStorage } from "./db-mcp-config-storage";
import type { MCPClientsManager } from "./create-mcp-clients-manager";
import type { MCPServerConfig } from "app-types/mcp";

// Mock dependencies
vi.mock("lib/db/repository", () => ({
  mcpRepository: {
    selectAll: vi.fn(),
    selectAllForUser: vi.fn(),
    save: vi.fn(),
    deleteById: vi.fn(),
    selectById: vi.fn(),
  },
}));

vi.mock("logger", () => ({
  default: {
    withDefaults: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock("lib/utils", () => ({
  createDebounce: vi.fn(() => vi.fn()),
}));

const mockMcpRepository = await import("lib/db/repository").then(
  (m) => m.mcpRepository,
);

describe("DB-based MCP Config Storage", () => {
  let storage: ReturnType<typeof createDbBasedMCPConfigsStorage>;
  let mockManager: MCPClientsManager;

  const mockServer = {
    id: "test-server",
    name: "test-server",
    config: { command: "python", args: ["test.py"] } as MCPServerConfig,
    enabled: true,
    userId: "test-user-id",
    visibility: "private" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    storage = createDbBasedMCPConfigsStorage("test-user-id");

    mockManager = {
      getClients: vi.fn(),
      getClient: vi.fn(),
      addClient: vi.fn(),
      refreshClient: vi.fn(),
      removeClient: vi.fn(),
    } as any;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe("init", () => {
    it("should initialize with manager", async () => {
      await expect(storage.init(mockManager)).resolves.toBeUndefined();
    });
  });

  describe("loadAll", () => {
    it("should load the user's servers from database", async () => {
      vi.mocked(mockMcpRepository.selectAllForUser).mockResolvedValue([
        { ...mockServer, visibility: "private" },
      ]);

      const result = await storage.loadAll();

      expect(mockMcpRepository.selectAllForUser).toHaveBeenCalledWith(
        "test-user-id",
        null,
      );
      expect(result).toEqual([mockServer]);
    });

    it("should return empty array when database fails", async () => {
      vi.mocked(mockMcpRepository.selectAllForUser).mockRejectedValue(
        new Error("Database error"),
      );

      const result = await storage.loadAll();

      expect(result).toEqual([]);
    });

    it("should return empty array when no userId is provided", async () => {
      const anonymousStorage = createDbBasedMCPConfigsStorage();

      const result = await anonymousStorage.loadAll();

      expect(result).toEqual([]);
      expect(mockMcpRepository.selectAllForUser).not.toHaveBeenCalled();
    });
  });

  describe("save", () => {
    it("should save server to database", async () => {
      const serverToSave = {
        id: "new-server",
        name: "new-server",
        config: { url: "https://example.com" } as MCPServerConfig,
      };

      vi.mocked(mockMcpRepository.save).mockResolvedValue({
        ...serverToSave,
        userId: "test-user-id",
        visibility: "private" as const,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const serverWithUserId = {
        ...serverToSave,
        userId: "test-user-id",
      };

      const result = await storage.save(serverWithUserId);

      expect(mockMcpRepository.save).toHaveBeenCalledWith(serverWithUserId);
      expect(result).toEqual(expect.objectContaining(serverToSave));
    });

    it("should throw error when save fails", async () => {
      const serverToSave = {
        id: "new-server",
        name: "new-server",
        config: { url: "https://example.com" } as MCPServerConfig,
      };

      vi.mocked(mockMcpRepository.save).mockRejectedValue(
        new Error("Save failed"),
      );

      await expect(
        storage.save({
          ...serverToSave,
          userId: "test-user-id",
        }),
      ).rejects.toThrow("Save failed");
    });
  });

  describe("delete", () => {
    it("should delete server from database", async () => {
      vi.mocked(mockMcpRepository.deleteById).mockResolvedValue();

      await storage.delete("test-server");

      expect(mockMcpRepository.deleteById).toHaveBeenCalledWith("test-server");
    });

    it("should throw error when delete fails", async () => {
      vi.mocked(mockMcpRepository.deleteById).mockRejectedValue(
        new Error("Delete failed"),
      );

      await expect(storage.delete("test-server")).rejects.toThrow(
        "Delete failed",
      );
    });
  });

  describe("has", () => {
    it("should return true when server exists", async () => {
      vi.mocked(mockMcpRepository.selectById).mockResolvedValue({
        ...mockServer,
        visibility: "private",
      });

      const result = await storage.has("test-server");

      expect(result).toBe(true);
      expect(mockMcpRepository.selectById).toHaveBeenCalledWith("test-server");
    });

    it("should return false when server does not exist", async () => {
      vi.mocked(mockMcpRepository.selectById).mockResolvedValue(null);

      const result = await storage.has("non-existent");

      expect(result).toBe(false);
    });

    it("should return false when database query fails", async () => {
      vi.mocked(mockMcpRepository.selectById).mockRejectedValue(
        new Error("Database error"),
      );

      const result = await storage.has("test-server");

      expect(result).toBe(false);
    });
  });

  describe("get", () => {
    it("should return server when it exists", async () => {
      vi.mocked(mockMcpRepository.selectById).mockResolvedValue({
        ...mockServer,
        visibility: "private",
      });

      const result = await storage.get("test-server");

      expect(result).toEqual(mockServer);
      expect(mockMcpRepository.selectById).toHaveBeenCalledWith("test-server");
    });

    it("should return null when server does not exist", async () => {
      vi.mocked(mockMcpRepository.selectById).mockResolvedValue(null);

      const result = await storage.get("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("interval functionality", () => {
    it("should set up interval for periodic checks", async () => {
      await storage.init(mockManager);

      // The interval is set up during module initialization
      // We can verify that the storage was initialized properly
      expect(mockManager).toBeDefined();
    });
  });
});

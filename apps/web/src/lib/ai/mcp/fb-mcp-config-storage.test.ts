import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFileBasedMCPConfigsStorage } from "./fb-mcp-config-storage";
import type { MCPClientsManager } from "./create-mcp-clients-manager";
import type { MCPServerConfig } from "app-types/mcp";
import { mkdir, readFile, writeFile } from "fs/promises";
import chokidar from "chokidar";

// Mock dependencies
vi.mock("fs/promises", () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("chokidar", () => ({
  default: {
    watch: vi.fn(),
  },
}));

vi.mock("logger", () => ({
  default: {
    withDefaults: vi.fn(() => ({
      debug: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock("lib/utils", () => ({
  createDebounce: vi.fn(() => vi.fn()),
  objectFlow: vi.fn(),
}));

vi.mock("lib/ai/mcp/config-path", () => ({
  MCP_CONFIG_PATH: "/test/config.json",
}));

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);
const mockChokidar = vi.mocked(chokidar);

describe("File-based MCP Config Storage", () => {
  let storage: ReturnType<typeof createFileBasedMCPConfigsStorage>;
  let mockManager: MCPClientsManager;
  let mockWatcher: any;

  const mockServerConfig: MCPServerConfig = {
    command: "python",
    args: ["test.py"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockWatcher = {
      close: vi.fn(),
      on: vi.fn(),
    };

    mockChokidar.watch.mockReturnValue(mockWatcher);

    storage = createFileBasedMCPConfigsStorage("/test/config.json");

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
    it("should initialize with existing config file", async () => {
      const configContent = JSON.stringify({
        "test-server": mockServerConfig,
      });

      mockReadFile.mockResolvedValue(configContent);

      await storage.init(mockManager);

      expect(mockReadFile).toHaveBeenCalledWith("/test/config.json", {
        encoding: "utf-8",
      });
      expect(mockChokidar.watch).toHaveBeenCalledWith("/test/config.json", {
        persistent: true,
        awaitWriteFinish: true,
        ignoreInitial: true,
      });
    });

    it("should create empty config file when readConfigFile throws non-ENOENT error", async () => {
      const error = new Error("Permission denied");
      (error as any).code = "EACCES";

      mockReadFile.mockRejectedValueOnce(error);
      mockWriteFile.mockResolvedValue(undefined);
      mockMkdir.mockResolvedValue(undefined);

      await expect(storage.init(mockManager)).rejects.toThrow(
        "Permission denied",
      );
    });

    it("should throw error for invalid JSON", async () => {
      mockReadFile.mockResolvedValue("invalid json");

      await expect(storage.init(mockManager)).rejects.toThrow(
        "Config file /test/config.json has invalid JSON",
      );
    });

    it("should close existing watcher before creating new one", async () => {
      mockReadFile.mockResolvedValue("{}");

      // First init
      await storage.init(mockManager);

      // Second init should close previous watcher
      await storage.init(mockManager);

      expect(mockWatcher.close).toHaveBeenCalled();
    });
  });

  describe("loadAll", () => {
    it("should load all servers from config file", async () => {
      const configContent = JSON.stringify({
        "test-server": mockServerConfig,
        "another-server": { url: "https://example.com" },
      });

      mockReadFile.mockResolvedValue(configContent);

      const result = await storage.loadAll();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: "test-server",
          name: "test-server",
          config: mockServerConfig,
        }),
      );
    });

    it("should return empty array for empty config file", async () => {
      mockReadFile.mockResolvedValue("{}");

      const result = await storage.loadAll();

      expect(result).toEqual([]);
    });

    it("should return empty array when file doesn't exist", async () => {
      const error = new Error("File not found");
      (error as any).code = "ENOENT";

      mockReadFile.mockRejectedValue(error);

      const result = await storage.loadAll();

      expect(result).toEqual([]);
    });
  });

  describe("save", () => {
    it("should save server to config file", async () => {
      const existingConfig = JSON.stringify({
        "existing-server": { command: "node" },
      });

      mockReadFile.mockResolvedValue(existingConfig);
      mockWriteFile.mockResolvedValue(undefined);
      mockMkdir.mockResolvedValue(undefined);

      const serverToSave = {
        id: "new-server",
        name: "new-server",
        config: { url: "https://example.com" } as MCPServerConfig,
      };

      const result = await storage.save({
        ...serverToSave,
        userId: "test-user-id",
      });

      expect(mockWriteFile).toHaveBeenCalledWith(
        "/test/config.json",
        expect.stringContaining('"new-server"'),
        "utf-8",
      );
      expect(result).toEqual(expect.objectContaining(serverToSave));
    });

    it("should create directory if it doesn't exist", async () => {
      mockReadFile.mockResolvedValue("{}");
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const serverToSave = {
        id: "new-server",
        name: "new-server",
        config: { url: "https://example.com" } as MCPServerConfig,
      };

      await storage.save({
        ...serverToSave,
        userId: "test-user-id",
      });

      expect(mockMkdir).toHaveBeenCalledWith("/test", { recursive: true });
    });
  });

  describe("delete", () => {
    it("should delete server from config file", async () => {
      const configContent = JSON.stringify({
        "test-server": mockServerConfig,
        "another-server": { url: "https://example.com" },
      });

      mockReadFile.mockResolvedValue(configContent);
      mockWriteFile.mockResolvedValue(undefined);
      mockMkdir.mockResolvedValue(undefined);

      await storage.delete("test-server");

      const writeCall = mockWriteFile.mock.calls[0];
      const writtenConfig = JSON.parse(writeCall[1] as string);

      expect(writtenConfig).not.toHaveProperty("test-server");
      expect(writtenConfig).toHaveProperty("another-server");
    });
  });

  describe("has", () => {
    it("should return true when server exists", async () => {
      const configContent = JSON.stringify({
        "test-server": mockServerConfig,
      });

      mockReadFile.mockResolvedValue(configContent);

      const result = await storage.has("test-server");

      expect(result).toBe(true);
    });

    it("should return false when server does not exist", async () => {
      mockReadFile.mockResolvedValue("{}");

      const result = await storage.has("non-existent");

      expect(result).toBe(false);
    });
  });

  describe("get", () => {
    it("should return server when it exists", async () => {
      const configContent = JSON.stringify({
        "test-server": mockServerConfig,
      });

      mockReadFile.mockResolvedValue(configContent);

      const result = await storage.get("test-server");

      expect(result).toEqual(
        expect.objectContaining({
          id: "test-server",
          name: "test-server",
          config: mockServerConfig,
        }),
      );
    });

    it("should return null when server does not exist", async () => {
      mockReadFile.mockResolvedValue("{}");

      const result = await storage.get("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("file watching", () => {
    beforeEach(async () => {
      mockReadFile.mockResolvedValue("{}");
      await storage.init(mockManager);
    });

    it("should setup file watcher on init", async () => {
      expect(mockChokidar.watch).toHaveBeenCalledWith("/test/config.json", {
        persistent: true,
        awaitWriteFinish: true,
        ignoreInitial: true,
      });
      expect(mockWatcher.on).toHaveBeenCalledWith(
        "change",
        expect.any(Function),
      );
    });

    it("should trigger refresh when file changes", async () => {
      const changeHandler = mockWatcher.on.mock.calls.find(
        (call) => call[0] === "change",
      )?.[1];

      expect(changeHandler).toBeDefined();

      // Simulate file change
      if (changeHandler) {
        changeHandler();
      }

      // The debounced function should be called
      expect(mockWatcher.on).toHaveBeenCalledWith(
        "change",
        expect.any(Function),
      );
    });
  });

  describe("utility functions", () => {
    it("should convert MCP server record to array format", async () => {
      const configContent = JSON.stringify({
        server1: { command: "python" },
        server2: { url: "https://example.com" },
      });

      mockReadFile.mockResolvedValue(configContent);

      const result = await storage.loadAll();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: "server1",
          name: "server1",
          enabled: true,
        }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          id: "server2",
          name: "server2",
          enabled: true,
        }),
      );
    });

    it("should fill missing schema fields with defaults", async () => {
      const configContent = JSON.stringify({
        "test-server": mockServerConfig,
      });

      mockReadFile.mockResolvedValue(configContent);

      const result = await storage.loadAll();

      expect(result[0]).toEqual(
        expect.objectContaining({
          id: "test-server",
          name: "test-server",
          config: mockServerConfig,
          enabled: true,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      );
    });
  });
});

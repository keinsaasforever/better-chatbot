import { describe, it, expect, beforeEach } from "vitest";
import { MemoryMCPConfigStorage } from "./memory-mcp-config-storage";
import type { McpServerInsert, MCPStdioConfig } from "app-types/mcp";

describe("MemoryMCPConfigStorage", () => {
  let storage: MemoryMCPConfigStorage;

  beforeEach(() => {
    storage = new MemoryMCPConfigStorage();
  });

  const createTestServer = (name: string): McpServerInsert => ({
    name,
    userId: "test-user-id",
    config: {
      command: "test-command",
      args: ["--test"],
      env: { TEST: "true" },
    } as MCPStdioConfig,
  });

  describe("init", () => {
    it("should initialize without errors", async () => {
      await expect(storage.init({} as any)).resolves.not.toThrow();
    });
  });

  describe("save", () => {
    it("should save a server configuration", async () => {
      const server = createTestServer("test-server");
      const saved = await storage.save(server);

      expect(saved).toMatchObject({
        name: "test-server",
        config: server.config,
      });
      expect(saved.id).toBeDefined();
      expect(saved.id).toMatch(/^memory-\d+$/);
    });

    it("should use provided id if available", async () => {
      const server = { ...createTestServer("test-server"), id: "custom-id" };
      const saved = await storage.save(server);

      expect(saved.id).toBe("custom-id");
    });

    it("should generate unique ids for multiple saves", async () => {
      const server1 = await storage.save(createTestServer("server1"));
      const server2 = await storage.save(createTestServer("server2"));

      expect(server1.id).not.toBe(server2.id);
    });
  });

  describe("loadAll", () => {
    it("should return empty array initially", async () => {
      const all = await storage.loadAll();
      expect(all).toEqual([]);
    });

    it("should return all saved configurations", async () => {
      await storage.save(createTestServer("server1"));
      await storage.save(createTestServer("server2"));
      await storage.save(createTestServer("server3"));

      const all = await storage.loadAll();
      expect(all).toHaveLength(3);
      expect(all.map((s) => s.name).sort()).toEqual([
        "server1",
        "server2",
        "server3",
      ]);
    });
  });

  describe("get", () => {
    it("should return null for non-existent id", async () => {
      const result = await storage.get("non-existent");
      expect(result).toBeNull();
    });

    it("should return saved configuration by id", async () => {
      const saved = await storage.save(createTestServer("test-server"));
      const retrieved = await storage.get(saved.id);

      expect(retrieved).toEqual(saved);
    });
  });

  describe("has", () => {
    it("should return false for non-existent id", async () => {
      const exists = await storage.has("non-existent");
      expect(exists).toBe(false);
    });

    it("should return true for existing id", async () => {
      const saved = await storage.save(createTestServer("test-server"));
      const exists = await storage.has(saved.id);

      expect(exists).toBe(true);
    });
  });

  describe("delete", () => {
    it("should delete existing configuration", async () => {
      const saved = await storage.save(createTestServer("test-server"));

      expect(await storage.has(saved.id)).toBe(true);
      await storage.delete(saved.id);
      expect(await storage.has(saved.id)).toBe(false);
    });

    it("should not throw when deleting non-existent id", async () => {
      await expect(storage.delete("non-existent")).resolves.not.toThrow();
    });
  });

  describe("clear", () => {
    it("should remove all configurations", async () => {
      await storage.save(createTestServer("server1"));
      await storage.save(createTestServer("server2"));
      await storage.save(createTestServer("server3"));

      expect(storage.size()).toBe(3);
      storage.clear();
      expect(storage.size()).toBe(0);
      expect(await storage.loadAll()).toEqual([]);
    });

    it("should reset id counter", async () => {
      const server1 = await storage.save(createTestServer("server1"));
      expect(server1.id).toBe("memory-1");

      storage.clear();

      const server2 = await storage.save(createTestServer("server2"));
      expect(server2.id).toBe("memory-1");
    });
  });

  describe("size", () => {
    it("should return 0 initially", () => {
      expect(storage.size()).toBe(0);
    });

    it("should return correct count after operations", async () => {
      await storage.save(createTestServer("server1"));
      expect(storage.size()).toBe(1);

      await storage.save(createTestServer("server2"));
      expect(storage.size()).toBe(2);

      const saved = await storage.save(createTestServer("server3"));
      expect(storage.size()).toBe(3);

      await storage.delete(saved.id);
      expect(storage.size()).toBe(2);
    });
  });
});

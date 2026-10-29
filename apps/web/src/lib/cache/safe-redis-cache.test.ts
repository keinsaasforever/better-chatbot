import { describe, it, expect, beforeEach, vi } from "vitest";
import { SafeRedisCache } from "./safe-redis-cache";
import { MemoryCache } from "./memory-cache";
import { RedisCache } from "./redis-cache";

vi.mock("./redis-cache");
vi.mock("logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("SafeRedisCache", () => {
  let cache: SafeRedisCache;
  let mockRedisCache: any;
  let mockMemoryCache: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisCache = {
      get: vi.fn(),
      set: vi.fn(),
      has: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      getAll: vi.fn(),
      disconnect: vi.fn(),
    };
    mockMemoryCache = new MemoryCache();
  });

  it("should use Redis when available", async () => {
    vi.mocked(RedisCache).mockImplementation(() => mockRedisCache);
    cache = new SafeRedisCache({ serverCache: mockMemoryCache });

    mockRedisCache.get.mockResolvedValue("value");
    const result = await cache.get("key");

    expect(result).toBe("value");
    expect(mockRedisCache.get).toHaveBeenCalledWith("key");
  });

  it("should fallback to memory cache when Redis fails", async () => {
    vi.mocked(RedisCache).mockImplementation(() => mockRedisCache);
    cache = new SafeRedisCache({ serverCache: mockMemoryCache });

    mockRedisCache.get.mockRejectedValue(new Error("Redis connection failed"));
    await mockMemoryCache.set("key", "memoryValue");

    const result = await cache.get("key");
    expect(result).toBe("memoryValue");
  });

  it("should handle rate limit errors gracefully", async () => {
    vi.mocked(RedisCache).mockImplementation(() => mockRedisCache);
    cache = new SafeRedisCache({ serverCache: mockMemoryCache });

    mockRedisCache.set.mockRejectedValue(new Error("rate limit exceeded"));
    await cache.set("key", "value");

    const result = await mockMemoryCache.get("key");
    expect(result).toBe("value");
  });

  it("should retry Redis connection after failure", async () => {
    vi.mocked(RedisCache).mockImplementation(() => mockRedisCache);
    cache = new SafeRedisCache({
      serverCache: mockMemoryCache,
      retryDelay: 100, // Short delay for testing
    });

    // First call fails
    mockRedisCache.get.mockRejectedValueOnce(new Error("Connection failed"));
    await cache.get("key1");

    // Wait for retry delay
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Next call should attempt reconnection
    mockRedisCache.has.mockResolvedValueOnce(true); // Connection test succeeds
    mockRedisCache.get.mockResolvedValueOnce("value2");

    const result = await cache.get("key2");
    expect(mockRedisCache.has).toHaveBeenCalledWith("__test__");
    expect(result).toBe("value2");
  });

  it("should set values in both caches when using Redis", async () => {
    vi.mocked(RedisCache).mockImplementation(() => mockRedisCache);
    cache = new SafeRedisCache({ serverCache: mockMemoryCache });

    mockRedisCache.set.mockResolvedValue(undefined);
    await cache.set("key", "value", 1000);

    expect(mockRedisCache.set).toHaveBeenCalledWith("key", "value", 1000);
    expect(await mockMemoryCache.get("key")).toBe("value");
  });

  it("should delete from both caches", async () => {
    vi.mocked(RedisCache).mockImplementation(() => mockRedisCache);
    cache = new SafeRedisCache({ serverCache: mockMemoryCache });

    await mockMemoryCache.set("key", "value");
    mockRedisCache.delete.mockResolvedValue(undefined);

    await cache.delete("key");

    expect(mockRedisCache.delete).toHaveBeenCalledWith("key");
    expect(await mockMemoryCache.has("key")).toBe(false);
  });

  it("should clear both caches", async () => {
    vi.mocked(RedisCache).mockImplementation(() => mockRedisCache);
    cache = new SafeRedisCache({ serverCache: mockMemoryCache });

    await mockMemoryCache.set("key1", "value1");
    await mockMemoryCache.set("key2", "value2");
    mockRedisCache.clear.mockResolvedValue(undefined);

    await cache.clear();

    expect(mockRedisCache.clear).toHaveBeenCalled();
    expect((await mockMemoryCache.getAll()).size).toBe(0);
  });

  it("should report cache status correctly", async () => {
    vi.mocked(RedisCache).mockImplementation(() => mockRedisCache);
    cache = new SafeRedisCache({ serverCache: mockMemoryCache });

    expect(cache.isUsingRedis()).toBe(true);
    expect(cache.getCacheStatus()).toEqual({
      redis: true,
      retries: 0,
    });

    // Simulate Redis failure
    mockRedisCache.get.mockRejectedValue(new Error("Connection failed"));
    await cache.get("key");

    expect(cache.isUsingRedis()).toBe(false);
    expect(cache.getCacheStatus().redis).toBe(false);
  });

  it("should handle OOM errors", async () => {
    vi.mocked(RedisCache).mockImplementation(() => mockRedisCache);
    cache = new SafeRedisCache({ serverCache: mockMemoryCache });

    mockRedisCache.set.mockRejectedValue(new Error("OOM command not allowed"));
    await cache.set("key", "value");

    const result = await mockMemoryCache.get("key");
    expect(result).toBe("value");
    expect(cache.isUsingRedis()).toBe(false);
  });

  it("should respect max retries limit", async () => {
    vi.mocked(RedisCache).mockImplementation(() => mockRedisCache);
    cache = new SafeRedisCache({
      serverCache: mockMemoryCache,
      maxRetries: 2,
      retryDelay: 50,
    });

    // Make Redis fail
    mockRedisCache.get.mockRejectedValue(new Error("Connection failed"));
    await cache.get("key");

    // Attempt retries
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      mockRedisCache.has.mockRejectedValue(new Error("Still failing"));
      await cache.get(`key${i}`);
    }

    const status = cache.getCacheStatus();
    expect(status.retries).toBeLessThanOrEqual(2);
  });
});

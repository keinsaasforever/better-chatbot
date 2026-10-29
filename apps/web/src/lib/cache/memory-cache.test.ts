import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { MemoryCache } from "./memory-cache";

describe("MemoryCache", () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  afterEach(() => {
    cache.clear();
  });

  test("should store and retrieve values", async () => {
    await cache.set("key1", "value1");
    const value = await cache.get("key1");
    expect(value).toBe("value1");
  });

  test("should return undefined for non-existent keys", async () => {
    const value = await cache.get("non-existent");
    expect(value).toBeUndefined();
  });

  test("should respect TTL and expire items", async () => {
    vi.useFakeTimers();
    try {
      await cache.set("expiring", "value", 100); // 100ms TTL

      expect(await cache.get("expiring")).toBe("value");

      // Advance time past TTL
      vi.advanceTimersByTime(101);

      expect(await cache.get("expiring")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test("should use default TTL when not specified", async () => {
    const cache = new MemoryCache();
    vi.useFakeTimers();

    try {
      await cache.set("key", "value"); // Uses default TTL (Infinity)

      expect(await cache.get("key")).toBe("value");

      // Advance time significantly - should still be there since TTL is Infinity
      vi.advanceTimersByTime(100000);

      expect(await cache.get("key")).toBe("value");
    } finally {
      vi.useRealTimers();
    }
  });

  test("should check if a key exists", async () => {
    await cache.set("exists", "value");

    expect(await cache.has("exists")).toBe(true);
    expect(await cache.has("does-not-exist")).toBe(false);
  });

  test("should delete keys", async () => {
    await cache.set("toDelete", "value");

    expect(await cache.get("toDelete")).toBe("value");

    await cache.delete("toDelete");

    expect(await cache.get("toDelete")).toBeUndefined();
  });

  test("should clear all keys", async () => {
    await cache.set("key1", "value1");
    await cache.set("key2", "value2");

    await cache.clear();

    expect(await cache.get("key1")).toBeUndefined();
    expect(await cache.get("key2")).toBeUndefined();
  });

  test("should handle complex values", async () => {
    const complexValue = {
      nested: {
        array: [1, 2, 3],
        boolean: true,
      },
      date: new Date().toISOString(),
    };

    await cache.set("complex", complexValue);

    expect(await cache.get("complex")).toEqual(complexValue);
  });

  test("should get all valid entries", async () => {
    await cache.set("key1", "value1");
    await cache.set("key2", "value2");
    await cache.set("key3", { nested: "value" });

    const allEntries = await cache.getAll();

    expect(allEntries.size).toBe(3);
    expect(allEntries.get("key1")).toBe("value1");
    expect(allEntries.get("key2")).toBe("value2");
    expect(allEntries.get("key3")).toEqual({ nested: "value" });
  });

  test("should return empty map when cache is empty", async () => {
    const allEntries = await cache.getAll();
    expect(allEntries.size).toBe(0);
  });

  test("should exclude expired entries from getAll", async () => {
    vi.useFakeTimers();
    try {
      await cache.set("valid", "value1");
      await cache.set("expiring", "value2", 100); // 100ms TTL

      // Before expiration
      let allEntries = await cache.getAll();
      expect(allEntries.size).toBe(2);
      expect(allEntries.get("valid")).toBe("value1");
      expect(allEntries.get("expiring")).toBe("value2");

      // After expiration
      vi.advanceTimersByTime(101);
      allEntries = await cache.getAll();
      expect(allEntries.size).toBe(1);
      expect(allEntries.get("valid")).toBe("value1");
      expect(allEntries.has("expiring")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("cleanup interval should remove expired items", async () => {
    vi.useFakeTimers();

    try {
      // Create cache with cleanup interval
      const cleanupCache = new MemoryCache({
        cleanupIntervalMs: 200,
      });

      // Set item with short TTL
      await cleanupCache.set("expire-me", "value", 100);

      // Advance time past TTL but before cleanup
      vi.advanceTimersByTime(101);

      // Item should still be in store but get() will return undefined
      expect(await cleanupCache.get("expire-me")).toBeUndefined();

      // Advance time to trigger cleanup
      vi.advanceTimersByTime(100);

      // The sweep should have removed the item from the store
      // We'll verify this is working by checking internal implementation
      const hasKey = (cleanupCache as any).store.has("expire-me");
      expect(hasKey).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

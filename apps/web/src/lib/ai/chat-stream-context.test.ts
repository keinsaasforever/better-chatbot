import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory ioredis stand-in so the stop/pointer helpers can be exercised
// without a live Redis. Only the commands the helpers use are implemented;
// the trailing "EX"/ttl args are accepted and ignored.
const store = new Map<string, string>();

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("resumable-stream/ioredis", () => ({
  createResumableStreamContext: () => ({}),
}));
vi.mock("ioredis", () => {
  class MockRedis {
    on() {
      return this;
    }
    async set(key: string, value: string) {
      store.set(key, value);
      return "OK";
    }
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    }
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    }
  }
  return { default: MockRedis };
});

// Read at module load, so it must be set before the dynamic import below.
process.env.REDIS_URL = "redis://mock:6379";

const {
  requestStop,
  isStopRequested,
  clearStop,
  setActiveStream,
  getActiveStream,
  clearActiveStream,
} = await import("./chat-stream-context");

beforeEach(() => store.clear());

describe("chat stream control keys", () => {
  it("round-trips the stop flag", async () => {
    expect(await isStopRequested("t1")).toBe(false);
    await requestStop("t1");
    expect(await isStopRequested("t1")).toBe(true);
    await clearStop("t1");
    expect(await isStopRequested("t1")).toBe(false);
  });

  it("scopes the stop flag per thread", async () => {
    await requestStop("t1");
    expect(await isStopRequested("t2")).toBe(false);
  });

  it("round-trips the active stream pointer", async () => {
    expect(await getActiveStream("t1")).toBeNull();
    await setActiveStream("t1", "stream-abc");
    expect(await getActiveStream("t1")).toBe("stream-abc");
    await clearActiveStream("t1");
    expect(await getActiveStream("t1")).toBeNull();
  });
});

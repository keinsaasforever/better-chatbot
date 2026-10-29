import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `getStreamContext` reads the Redis URL at module load, so each case
// re-imports the module under a different environment.
const warn = vi.fn();
const info = vi.fn();
const createResumableStreamContext = vi.fn(() => ({ mocked: true }));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("logger", () => ({
  default: { withDefaults: () => ({ warn, info, error: vi.fn() }) },
}));
vi.mock("resumable-stream/ioredis", () => ({
  createResumableStreamContext: () => createResumableStreamContext(),
}));
vi.mock("ioredis", () => ({
  default: class {
    on() {
      return this;
    }
  },
}));

const ORIGINAL = {
  REDIS_URL: process.env.REDIS_URL,
  KV_URL: process.env.KV_URL,
};

async function load(env: { REDIS_URL?: string; KV_URL?: string }) {
  vi.resetModules();
  delete process.env.REDIS_URL;
  delete process.env.KV_URL;
  Object.assign(process.env, env);
  return import("./chat-stream-context");
}

beforeEach(() => {
  warn.mockClear();
  info.mockClear();
  createResumableStreamContext.mockClear();
});

afterEach(() => {
  delete process.env.REDIS_URL;
  delete process.env.KV_URL;
  Object.assign(process.env, ORIGINAL);
});

describe("getStreamContext mode", () => {
  it("is disabled without a Redis URL and says so once", async () => {
    const { getStreamContext } = await load({});
    expect(getStreamContext()).toBeNull();
    expect(getStreamContext()).toBeNull();
    expect(createResumableStreamContext).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/resumable streams disabled/);
  });

  it("is enabled with REDIS_URL", async () => {
    const { getStreamContext } = await load({ REDIS_URL: "redis://x:6379" });
    expect(getStreamContext()).not.toBeNull();
    expect(createResumableStreamContext).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(info.mock.calls[0][0]).toMatch(/resumable streams enabled/);
  });

  it("accepts KV_URL, the name the Vercel/Upstash integration provisions", async () => {
    const { getStreamContext } = await load({ KV_URL: "rediss://x:6379" });
    expect(getStreamContext()).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

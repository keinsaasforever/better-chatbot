import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The supabase storage driver creates a real client at import time when both
// env vars are present. Stub it so tests don't spin up a live client (which
// crashes on Node < 22 without native WebSocket support).
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({})),
}));

const importActions = async () => await import("./actions");

// Storage is Supabase-only; configuration is validated against the Supabase env vars.
describe("checkStorageAction", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.FILE_STORAGE_TYPE;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("invalid when SUPABASE_URL is missing", async () => {
    const { checkStorageAction } = await importActions();
    const res = await checkStorageAction();
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/SUPABASE_URL/);
  });

  it("invalid when service role key is missing", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    const { checkStorageAction } = await importActions();
    const res = await checkStorageAction();
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("valid with required Supabase envs", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const { checkStorageAction } = await importActions();
    const res = await checkStorageAction();
    expect(res.isValid).toBe(true);
  });
});

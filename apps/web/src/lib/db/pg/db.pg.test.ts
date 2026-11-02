import { describe, expect, it, vi } from "vitest";

vi.mock("postgres", () => ({ default: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: vi.fn(() => ({})) }));

const { resolveConnectionString } = await import("./db.pg");

describe("resolveConnectionString", () => {
  it("drops pooler hints postgres.js would send to the server", () => {
    const url = resolveConnectionString(
      "postgres://u:p@aws-0.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x",
    );
    expect(url).toBe(
      "postgres://u:p@aws-0.pooler.supabase.com:6543/postgres?sslmode=require",
    );
  });

  it("leaves a plain connection string alone", () => {
    expect(resolveConnectionString("postgres://u:p@localhost:5432/db")).toBe(
      "postgres://u:p@localhost:5432/db",
    );
  });
});

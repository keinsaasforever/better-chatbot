import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ wheres: [] as unknown[] }));

vi.mock("auth/route-guard", () => ({
  withAuth:
    (handler: (request: Request, session: unknown) => Promise<Response>) =>
    (request: Request) =>
      handler(request, {
        user: { id: "11111111-2222-3333-4444-555555555555" },
        session: { activeOrganizationId: null },
      }),
}));

// Chainable stub: records each WHERE clause, resolves to an empty result.
vi.mock("@/lib/db/pg/db.pg", () => {
  const chain = (): any => {
    const builder: any = {
      from: () => builder,
      where: (clause: unknown) => {
        captured.wheres.push(clause);
        return builder;
      },
      orderBy: () => builder,
      limit: () => Promise.resolve([]),
      then: (resolve: (v: unknown) => void) => resolve([{ count: 0 }]),
    };
    return builder;
  };
  return { pgDb: { select: chain } };
});

const { GET } = await import("./route");
const dialect = new PgDialect();
const sqlOf = (i: number) => dialect.sqlToQuery(captured.wheres[i] as SQL);

describe("GET /api/notifications", () => {
  beforeEach(() => {
    captured.wheres = [];
  });

  it("returns every type without a filter", async () => {
    const res = await GET(
      new Request("http://test/api/notifications") as never,
    );
    expect(res.status).toBe(200);
    expect(sqlOf(0).sql).not.toContain('"type"');
  });

  it("limits list and unread count to the requested types", async () => {
    const res = await GET(
      new Request(
        "http://test/api/notifications?type=cockpit_update,project_digest&limit=8",
      ) as never,
    );
    expect(res.status).toBe(200);
    for (const i of [0, 1]) {
      const { sql, params } = sqlOf(i);
      expect(sql).toContain('"notification"."type" in ($2, $3)');
      expect(params).toContain("cockpit_update");
      expect(params).toContain("project_digest");
    }
  });

  it("accepts the cockpit severity suffixes", async () => {
    const res = await GET(
      new Request(
        "http://test/api/notifications?type=cockpit_update,cockpit_update.warn,cockpit_update.alert&limit=8",
      ) as never,
    );
    expect(res.status).toBe(200);
    const { sql, params } = sqlOf(0);
    expect(sql).toContain('"notification"."type" in ($2, $3, $4)');
    expect(params).toEqual(
      expect.arrayContaining([
        "cockpit_update",
        "cockpit_update.warn",
        "cockpit_update.alert",
      ]),
    );
  });

  it("rejects a malformed type list", async () => {
    const res = await GET(
      new Request("http://test/api/notifications?type=DROP%20TABLE") as never,
    );
    expect(res.status).toBe(400);
    expect(captured.wheres).toHaveLength(0);
  });
});

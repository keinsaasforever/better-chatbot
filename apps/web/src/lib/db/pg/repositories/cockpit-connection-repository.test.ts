import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

// The scope predicate only builds SQL; no query is ever sent.
vi.mock("../db.pg", async () => {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  return { pgDb: drizzle.mock() };
});

const { cockpitScopeWhere } = await import(
  "./cockpit-connection-repository.pg"
);

const dialect = new PgDialect();
const render = (userId: string, orgId: string | null) =>
  dialect.sqlToQuery(cockpitScopeWhere(userId, orgId));

describe("cockpitScopeWhere", () => {
  it("fails closed to the user's own rows when no organization is active", () => {
    const { sql, params } = render("user-1", null);
    expect(sql).toContain('"cockpit_connection"."organization_id" is null');
    expect(sql).toContain('"cockpit_connection"."user_id" = $1');
    expect(params).toEqual(["user-1"]);
    expect(sql).not.toContain("member");
  });

  it("matches organization rows only while the user is a member", () => {
    const { sql, params } = render("user-1", "org-1");
    expect(sql).toContain('"cockpit_connection"."organization_id" = $1');
    expect(sql).toMatch(/exists \(select 1 from "member"/);
    expect(sql).toContain('"member"."organization_id" = $2');
    expect(sql).toContain('"member"."user_id" = $3');
    expect(params).toEqual(["org-1", "org-1", "user-1"]);
    // Org rows are shared inside the org, never filtered to the creator.
    expect(sql).not.toContain('"cockpit_connection"."user_id"');
  });
});

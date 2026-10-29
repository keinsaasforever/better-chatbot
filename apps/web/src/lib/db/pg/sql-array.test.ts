import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, test } from "vitest";
import { pgArray } from "./sql-array";

const dialect = new PgDialect();

describe("pgArray", () => {
  test("renders an array literal, not a row constructor", () => {
    const query = dialect.sqlToQuery(
      sql`SELECT 1 WHERE id = ANY(${pgArray(["a", "b"], "uuid")})`,
    );

    // The regression: Drizzle's own array binding produced `(($1, $2))::uuid[]`,
    // which Postgres rejects with "cannot cast type record to uuid[]".
    expect(query.sql).toContain("ARRAY[$1, $2]::uuid[]");
    expect(query.params).toEqual(["a", "b"]);
  });

  test("a single value is still an array, not a bare scalar", () => {
    const query = dialect.sqlToQuery(
      sql`SELECT * FROM unnest(${pgArray(["uros"], "text")})`,
    );

    expect(query.sql).toContain("ARRAY[$1]::text[]");
    expect(query.params).toEqual(["uros"]);
  });

  test("an empty array stays typed so ANY(...) is simply false", () => {
    const query = dialect.sqlToQuery(sql`${pgArray([], "text")}`);

    expect(query.sql).toBe("ARRAY[]::text[]");
    expect(query.params).toEqual([]);
  });
});

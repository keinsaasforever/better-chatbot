import { type SQL, sql } from "drizzle-orm";

/**
 * Binds a JS array as a real Postgres array inside a raw `sql` template.
 *
 * Drizzle renders `sql`${["a", "b"]}`` as a parenthesised parameter list —
 * `($1, $2)` — which Postgres reads as a row constructor, not an array.
 * Casting that to an array type fails at BIND time: "cannot cast type record
 * to uuid[]" for several values, or "malformed array literal" for one (the
 * parens collapse to a plain scalar). Build the array literal explicitly
 * instead, so every element stays a bound parameter.
 *
 * Use this for `= ANY(...)` / `unnest(...)`; for a plain `IN` list prefer
 * Drizzle's own `inArray`.
 */
export function pgArray(values: readonly string[], type: "text" | "uuid"): SQL {
  const cast = type === "uuid" ? sql`::uuid[]` : sql`::text[]`;
  const elements = sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
  return sql`ARRAY[${elements}]${cast}`;
}

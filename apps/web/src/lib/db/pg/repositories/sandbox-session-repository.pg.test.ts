import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * DB-free per the repo convention: `pgDb` is mocked so the query *shape* is
 * what gets asserted. The builder records every `where` predicate it is handed
 * so we can prove the ownership and state filters are actually applied — those
 * are the clauses that keep one tenant from touching another's sandbox.
 */
const h = vi.hoisted(() => ({
  rows: [] as any[],
  updateReturning: [] as any[],
  capturedWhere: [] as any[],
  capturedSet: [] as any[],
}));

/**
 * Drizzle predicates are self-referential (a column points back at its table),
 * so they cannot be JSON-stringified. Walk them with a seen-set and collect
 * the literal values instead — those are the bound parameters, which is
 * exactly what we want to assert on.
 */
function boundValues(predicate: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown) => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      found.push(node);
      return;
    }
    if (typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const value of Object.values(node as Record<string, unknown>)) {
      walk(value);
    }
  };

  walk(predicate);
  return found;
}

function recordingChain(result: () => any[]) {
  const chain: any = {
    from: () => chain,
    where: (predicate: unknown) => {
      h.capturedWhere.push(predicate);
      return chain;
    },
    orderBy: () => chain,
    limit: () => Promise.resolve(result()),
    returning: () => Promise.resolve(result()),
    then: (resolve: (value: any[]) => unknown) => resolve(result()),
  };
  return chain;
}

vi.mock("../db.pg", () => ({
  pgDb: {
    select: () => recordingChain(() => h.rows),
    update: () => ({
      set: (values: unknown) => {
        h.capturedSet.push(values);
        return recordingChain(() => h.updateReturning);
      },
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: () => Promise.resolve(h.rows),
        }),
      }),
    }),
  },
}));

const { pgSandboxSessionRepository } = await import(
  "./sandbox-session-repository.pg"
);

beforeEach(() => {
  h.rows = [];
  h.updateReturning = [];
  h.capturedWhere = [];
  h.capturedSet = [];
});

describe("touch", () => {
  test("reports success only when a row was actually updated", async () => {
    // Zero rows means "not yours, or unknown" — the route turns that into a
    // 403, so this boolean is the authorization decision.
    h.updateReturning = [{ sandboxId: "sbx_1" }];
    expect(await pgSandboxSessionRepository.touch("sbx_1", "user_1")).toBe(
      true,
    );

    h.updateReturning = [];
    expect(await pgSandboxSessionRepository.touch("sbx_1", "user_2")).toBe(
      false,
    );
  });

  test("bumps lastActiveAt so the reaper can tell idle from abandoned", async () => {
    h.updateReturning = [{ sandboxId: "sbx_1" }];

    await pgSandboxSessionRepository.touch("sbx_1", "user_1");

    expect(h.capturedSet[0]).toMatchObject({ state: "running" });
    expect(h.capturedSet[0].lastActiveAt).toBeDefined();
  });

  test("scopes the update by user, never by sandbox id alone", async () => {
    h.updateReturning = [];

    await pgSandboxSessionRepository.touch("sbx_1", "user_1");

    expect(h.capturedWhere).toHaveLength(1);
    expect(boundValues(h.capturedWhere[0])).toContain("user_1");
  });
});

describe("findReusable", () => {
  test("filters by thread, template and owner", async () => {
    h.rows = [{ sandboxId: "sbx_1" }];

    const row = await pgSandboxSessionRepository.findReusable({
      threadId: "11111111-1111-1111-1111-111111111111",
      template: "nextjs-developer",
      userId: "user_1",
      maxAgeMs: 60_000,
    });

    expect(row).toEqual({ sandboxId: "sbx_1" });
    const predicate = boundValues(h.capturedWhere[0]);
    expect(predicate).toContain("user_1");
    expect(predicate).toContain("nextjs-developer");
    // `killed` is terminal — the ID can never be resurrected, so a killed row
    // must never be offered for reuse.
    expect(predicate).toContain("killed");
  });

  test("returns undefined when nothing matches", async () => {
    h.rows = [];

    await expect(
      pgSandboxSessionRepository.findReusable({
        threadId: "11111111-1111-1111-1111-111111111111",
        template: "nextjs-developer",
        userId: "user_1",
        maxAgeMs: 60_000,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("listSuperseded", () => {
  test("excludes the sandbox being kept", async () => {
    h.rows = [{ sandboxId: "sbx_old" }];

    const rows = await pgSandboxSessionRepository.listSuperseded({
      threadId: "11111111-1111-1111-1111-111111111111",
      template: "nextjs-developer",
      keepSandboxId: "sbx_new",
    });

    expect(rows).toEqual([{ sandboxId: "sbx_old" }]);
    expect(boundValues(h.capturedWhere[0])).toContain("sbx_new");
  });
});

describe("findKnownIds", () => {
  test("short-circuits on an empty list without querying", async () => {
    const known = await pgSandboxSessionRepository.findKnownIds([]);

    expect(known.size).toBe(0);
    expect(h.capturedWhere).toHaveLength(0);
  });

  test("returns the subset the registry knows about", async () => {
    h.rows = [{ sandboxId: "sbx_1" }];

    const known = await pgSandboxSessionRepository.findKnownIds([
      "sbx_1",
      "sbx_2",
    ]);

    expect(known.has("sbx_1")).toBe(true);
    expect(known.has("sbx_2")).toBe(false);
  });
});

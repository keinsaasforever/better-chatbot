import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  org: null as { metadata: string | null } | null,
  members: [] as unknown[],
  updates: [] as unknown[],
  selectCalls: 0,
  failUpdate: false,
}));

vi.mock("lib/db/pg/db.pg", () => {
  const select = () => {
    const call = h.selectCalls;
    const query: any = {
      from: () => query,
      // First select reads the organization, second reads its members.
      where: () => {
        h.selectCalls += 1;
        return call === 0
          ? { limit: () => Promise.resolve(h.org ? [h.org] : []) }
          : Promise.resolve(h.members);
      },
    };
    return query;
  };
  return {
    pgDb: {
      select,
      update: () => ({
        set: (values: unknown) => ({
          where: () => {
            if (h.failUpdate) throw new Error("write failed");
            h.updates.push(values);
            return Promise.resolve();
          },
        }),
      }),
    },
  };
});

vi.mock("logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { promoteSharedPersonalOrganization } = await import(
  "./promote-shared-org"
);

const ORG_ID = "f910a0a8-6e2f-454d-8ae8-ebacc062f7e6";
const OWNER_ID = "198fdf5c-2d4f-4a7b-89e9-65d3082f6cb9";

beforeEach(() => {
  h.org = null;
  h.members = [];
  h.updates = [];
  h.selectCalls = 0;
  h.failUpdate = false;
});

describe("promoteSharedPersonalOrganization", () => {
  // The production case: a workspace renamed and shared with eight colleagues
  // while still flagged personal, which billed every one of them individually.
  it("clears the flag once a personal workspace has other members", async () => {
    h.org = {
      metadata: JSON.stringify({ personal: true, userId: OWNER_ID }),
    };
    h.members = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}` }));

    await expect(promoteSharedPersonalOrganization(ORG_ID)).resolves.toBe(true);
    expect(h.updates).toHaveLength(1);
    // The flag goes; the record of who created it stays.
    expect(JSON.parse((h.updates[0] as { metadata: string }).metadata)).toEqual(
      {
        userId: OWNER_ID,
      },
    );
  });

  it("leaves a genuine one-person workspace alone", async () => {
    h.org = {
      metadata: JSON.stringify({ personal: true, userId: OWNER_ID }),
    };
    h.members = [{ id: "m0" }];

    await expect(promoteSharedPersonalOrganization(ORG_ID)).resolves.toBe(
      false,
    );
    expect(h.updates).toHaveLength(0);
  });

  it("leaves a team organization alone", async () => {
    h.org = { metadata: JSON.stringify({ seats: 9 }) };
    h.members = [{ id: "m0" }, { id: "m1" }];

    await expect(promoteSharedPersonalOrganization(ORG_ID)).resolves.toBe(
      false,
    );
    expect(h.updates).toHaveLength(0);
  });

  it("does nothing for an organization that cannot be read", async () => {
    h.org = null;
    await expect(promoteSharedPersonalOrganization(ORG_ID)).resolves.toBe(
      false,
    );
    expect(h.updates).toHaveLength(0);
  });

  it("propagates a write failure so the caller can log it", async () => {
    h.org = {
      metadata: JSON.stringify({ personal: true, userId: OWNER_ID }),
    };
    h.members = [{ id: "m0" }, { id: "m1" }];
    h.failUpdate = true;

    await expect(promoteSharedPersonalOrganization(ORG_ID)).rejects.toThrow(
      "write failed",
    );
  });
});

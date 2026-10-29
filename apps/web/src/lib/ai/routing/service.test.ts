import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Any DB access must fail the test — the Local Models bypass has to return
// before touching the routing tables.
vi.mock("@/lib/db/pg/db.pg", () => ({
  pgDb: new Proxy(
    {},
    {
      get() {
        throw new Error("pgDb must not be touched by the Local Models bypass");
      },
    },
  ),
}));

import { validateManualModel } from "./service";

describe("validateManualModel — Local Models bypass", () => {
  it("returns a Local Models pick without hitting the routing tables", async () => {
    const chatModel = { provider: "Local Models", model: "llama3.2:latest" };

    await expect(
      validateManualModel({
        organizationId: "org-1",
        userId: "user-1",
        chatModel,
      }),
    ).resolves.toEqual({ chatModel });
  });

  it("still bypasses when there is no active organization", async () => {
    const chatModel = { provider: "Local Models", model: "qwen2.5:7b" };

    await expect(
      validateManualModel({
        organizationId: null,
        userId: "user-1",
        chatModel,
      }),
    ).resolves.toEqual({ chatModel });
  });
});

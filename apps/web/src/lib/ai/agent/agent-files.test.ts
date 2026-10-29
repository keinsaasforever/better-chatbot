import { describe, expect, test } from "vitest";
import { assertOwnedAgentFiles } from "./agent-files";

const file = (storageKey: string) => ({
  storageKey,
  filename: "template.html",
});

describe("assertOwnedAgentFiles", () => {
  test("accepts keys under the caller's own prefix", () => {
    expect(
      assertOwnedAgentFiles({
        files: [file("user-1/template.html"), file("user-1/render.py")],
        userId: "user-1",
      }),
    ).toEqual({ ok: true });
  });

  test("rejects a key belonging to another user", () => {
    expect(
      assertOwnedAgentFiles({
        files: [file("user-2/secrets.pdf")],
        userId: "user-1",
      }),
    ).toEqual({ ok: false, storageKey: "user-2/secrets.pdf" });
  });

  test("rejects traversal even under the caller's prefix", () => {
    expect(
      assertOwnedAgentFiles({
        files: [file("user-1/../user-2/secrets.pdf")],
        userId: "user-1",
      }).ok,
    ).toBe(false);
  });

  test("carries over keys already stored on the agent", () => {
    // An org member editing a shared agent does not own the creator's files.
    expect(
      assertOwnedAgentFiles({
        files: [file("user-2/template.html")],
        userId: "user-1",
        existingFiles: [file("user-2/template.html")],
      }),
    ).toEqual({ ok: true });
  });

  test("still rejects a NEW foreign key on an agent that has carried-over ones", () => {
    expect(
      assertOwnedAgentFiles({
        files: [file("user-2/template.html"), file("user-3/other.pdf")],
        userId: "user-1",
        existingFiles: [file("user-2/template.html")],
      }),
    ).toEqual({ ok: false, storageKey: "user-3/other.pdf" });
  });

  test("accepts an agent with no files", () => {
    expect(
      assertOwnedAgentFiles({ files: undefined, userId: "user-1" }),
    ).toEqual({ ok: true });
  });
});

import { describe, expect, test } from "vitest";
import {
  AgentCreateSchema,
  AgentInstructionsSchema,
  MAX_AGENT_FILES,
} from "./agent";

const file = (filename: string) => ({
  storageKey: `user-1/${filename}`,
  filename,
});

describe("AgentInstructionsSchema files", () => {
  test("accepts file bindings alongside the prompt", () => {
    const parsed = AgentInstructionsSchema.parse({
      systemPrompt: "Fill the template from the JSON.",
      files: [file("template.html"), file("render.py")],
    });

    expect(parsed.files).toHaveLength(2);
    expect(parsed.files?.[0].storageKey).toBe("user-1/template.html");
  });

  test("files are optional, so existing agents keep parsing", () => {
    expect(
      AgentInstructionsSchema.parse({ systemPrompt: "Hi" }).files,
    ).toBeUndefined();
  });

  test("rejects a binding with no storage key", () => {
    expect(() =>
      AgentInstructionsSchema.parse({
        files: [{ storageKey: "", filename: "template.html" }],
      }),
    ).toThrow();
  });

  test("caps the number of files at what staging can handle", () => {
    const tooMany = Array.from({ length: MAX_AGENT_FILES + 1 }, (_, i) =>
      file(`file-${i}.txt`),
    );
    expect(() => AgentInstructionsSchema.parse({ files: tooMany })).toThrow();
  });
});

describe("AgentCreateSchema", () => {
  test("carries file bindings through creation", () => {
    const parsed = AgentCreateSchema.parse({
      name: "Bautagebuch",
      userId: "user-1",
      instructions: {
        systemPrompt: "Fill the template.",
        files: [file("template.html")],
      },
    });

    expect(parsed.instructions.files).toHaveLength(1);
  });

  test("still strips organizationId, which is server-derived", () => {
    const parsed = AgentCreateSchema.parse({
      name: "Bautagebuch",
      userId: "user-1",
      organizationId: "org-someone-else",
      instructions: { systemPrompt: "Hi" },
    });

    expect(parsed).not.toHaveProperty("organizationId");
  });
});

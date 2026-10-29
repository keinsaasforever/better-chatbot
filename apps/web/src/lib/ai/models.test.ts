import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_FILE_MIME_TYPES,
  OPENAI_FILE_MIME_TYPES,
} from "./file-support";

vi.mock("server-only", () => ({}));

let modelsModule: typeof import("./models");

beforeAll(async () => {
  modelsModule = await import("./models");
});

describe("customModelProvider file support metadata", () => {
  it("includes default file support for OpenAI gpt-5.6-terra", () => {
    const { customModelProvider, getFilePartSupportedMimeTypes } = modelsModule;
    const model = customModelProvider.getModel({
      provider: "openai",
      model: "gpt-5.6-terra",
    });
    expect(getFilePartSupportedMimeTypes(model)).toEqual(
      Array.from(OPENAI_FILE_MIME_TYPES),
    );

    const openaiProvider = customModelProvider.modelsInfo.find(
      (item) => item.provider === "openai",
    );
    const metadata = openaiProvider?.models.find(
      (item) => item.name === "gpt-5.6-terra",
    );

    expect(metadata?.supportedFileMimeTypes).toEqual(
      Array.from(OPENAI_FILE_MIME_TYPES),
    );
  });

  it("adds rich support for anthropic claude-sonnet-5", () => {
    const { customModelProvider, getFilePartSupportedMimeTypes } = modelsModule;
    const model = customModelProvider.getModel({
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    expect(getFilePartSupportedMimeTypes(model)).toEqual(
      Array.from(ANTHROPIC_FILE_MIME_TYPES),
    );
  });
});

describe("supportsImageInput", () => {
  it("is true for the vision models PDF rendering depends on", () => {
    const { supportsImageInput } = modelsModule;

    for (const model of [
      { provider: "anthropic", model: "claude-sonnet-5" },
      { provider: "openai", model: "gpt-5.6-terra" },
      { provider: "google", model: "gemini-2.5-flash" },
      { provider: "xai", model: "grok-4.5" },
      { provider: "Navigator", model: "Base model" },
    ]) {
      expect(
        supportsImageInput(model),
        `${model.provider}/${model.model}`,
      ).toBe(true);
    }
  });

  it("is false for the text-only models still in the catalog", () => {
    // These are why the extracted-text path has to stay: the catalog is not
    // all vision models, so a rendered page would be dropped or rejected.
    const { supportsImageInput } = modelsModule;

    for (const model of [
      { provider: "deepseek", model: "deepseek-v3.2" },
      { provider: "mistral", model: "mistral-large-3" },
      { provider: "zai", model: "glm-5.2" },
      { provider: "alibaba", model: "qwen3.7-max" },
    ]) {
      expect(
        supportsImageInput(model),
        `${model.provider}/${model.model}`,
      ).toBe(false);
    }
  });

  it("reports the fallback's capability for an absent or unknown id", () => {
    // Both resolve to `fallbackModel`, which is what will serve the turn, so
    // the answer has to describe that model rather than the id that was asked
    // for. Returning false here would skip rendering on exactly those turns.
    const { supportsImageInput } = modelsModule;
    expect(supportsImageInput()).toBe(true);
    expect(supportsImageInput({ provider: "nope", model: "nope" })).toBe(true);
  });

  it("treats a non-gateway model instance as text-only", () => {
    // Ollama and Groq resolve to SDK instances, not ids, so there is nothing
    // to look up; a rejected image is worse than a slightly worse answer.
    const { supportsImageInput } = modelsModule;
    expect(supportsImageInput({ provider: "ollama", model: "gemma3:4b" })).toBe(
      false,
    );
  });
});

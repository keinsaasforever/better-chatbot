import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./register-gateway-provider", () => ({}));

const ORIGINAL_KEY = process.env.TENSORX_API_KEY;

async function loadModels(apiKey: string | undefined) {
  vi.resetModules();
  if (apiKey === undefined) {
    delete process.env.TENSORX_API_KEY;
  } else {
    process.env.TENSORX_API_KEY = apiKey;
  }
  return import("./models");
}

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.TENSORX_API_KEY;
  } else {
    process.env.TENSORX_API_KEY = ORIGINAL_KEY;
  }
});

describe("TensorX provider (configured)", () => {
  let models: typeof import("./models");

  beforeEach(async () => {
    models = await loadModels("test-key");
  });

  it("offers exactly the curated lineup", () => {
    const provider = models.customModelProvider.modelsInfo.find(
      (entry) => entry.provider === "TensorX",
    );
    expect(provider?.models.map((model) => model.name)).toEqual([
      "kimi-k3",
      "qwen3.8-2.4t-a95b",
      "minimax-m2",
    ]);
    expect(provider?.hasAPIKey).toBe(true);
    // Kimi K3 is the only one of the three that takes image input.
    expect(
      provider?.models.map((model) => model.isImageInputUnsupported),
    ).toEqual([false, true, true]);
  });

  it("resolves a pick to the direct TensorX client, never a gateway string", () => {
    const model = models.customModelProvider.getModel({
      provider: "TensorX",
      model: "minimax-m2",
    });
    expect(typeof model).not.toBe("string");
    expect((model as { modelId: string }).modelId).toBe("minimax/minimax-m2");
  });

  it("resolves the same model through the chat entry point", async () => {
    const model = await models.getModelInstance({
      provider: "TensorX",
      model: "kimi-k3",
    });
    expect((model as { modelId: string }).modelId).toBe("moonshotai/kimi-k3");
  });

  it("throws on an unknown TensorX model instead of falling back to the gateway", () => {
    expect(() =>
      models.customModelProvider.getModel({
        provider: "TensorX",
        model: "not-a-model",
      }),
    ).toThrow(/Unknown TensorX model/);
  });
});

describe("TensorX provider (not configured)", () => {
  it("reports no API key and refuses to resolve a model", async () => {
    const models = await loadModels(undefined);

    const provider = models.customModelProvider.modelsInfo.find(
      (entry) => entry.provider === "TensorX",
    );
    expect(provider?.hasAPIKey).toBe(false);

    // Falling back to the gateway here would quietly move zero-retention
    // traffic onto a retaining path, so this must fail loudly instead.
    expect(() =>
      models.customModelProvider.getModel({
        provider: "TensorX",
        model: "kimi-k3",
      }),
    ).toThrow(/TensorX is not configured/);
  });
});

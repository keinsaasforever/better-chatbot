import { describe, expect, it } from "vitest";
import {
  AUTO_IMAGE_MODEL_ID,
  DEFAULT_IMAGE_MODEL_ID,
  IMAGE_MODELS,
  SELECTABLE_IMAGE_MODELS,
  pickImageModel,
  resolveImageModel,
} from "./image-models";

describe("pickImageModel", () => {
  it("routes a mask to the inpainting model regardless of the manual pick", () => {
    const picked = pickImageModel({
      requestedModelId: "openai/gpt-image-2",
      mode: "edit",
      imageCount: 1,
      hasMask: true,
    });
    expect(picked.id).toBe("bfl/flux-pro-1.0-fill");
    expect(picked.capabilities.mask).toBe(true);
  });

  it("honours a manual pick when there is no mask", () => {
    const picked = pickImageModel({
      requestedModelId: "openai/gpt-image-2",
      mode: "edit",
      imageCount: 1,
      hasMask: false,
    });
    expect(picked.id).toBe("openai/gpt-image-2");
  });

  it("never lets a hidden model be picked by id", () => {
    const picked = pickImageModel({
      requestedModelId: "bfl/flux-pro-1.0-fill",
      mode: "create",
      imageCount: 0,
      hasMask: false,
    });
    expect(picked.id).toBe(DEFAULT_IMAGE_MODEL_ID);
  });

  it("auto: create without images uses the default model", () => {
    const picked = pickImageModel({
      requestedModelId: AUTO_IMAGE_MODEL_ID,
      mode: "create",
      imageCount: 0,
      hasMask: false,
    });
    expect(picked.id).toBe(DEFAULT_IMAGE_MODEL_ID);
  });

  it("auto: editing one image uses Kontext", () => {
    const picked = pickImageModel({
      requestedModelId: undefined,
      mode: "edit",
      imageCount: 1,
      hasMask: false,
    });
    expect(picked.id).toBe("bfl/flux-kontext-pro");
  });

  it("auto: several images or composite use FLUX.2 Pro", () => {
    expect(
      pickImageModel({
        requestedModelId: AUTO_IMAGE_MODEL_ID,
        mode: "edit",
        imageCount: 2,
        hasMask: false,
      }).id,
    ).toBe("bfl/flux-2-pro");
    expect(
      pickImageModel({
        requestedModelId: AUTO_IMAGE_MODEL_ID,
        mode: "composite",
        imageCount: 1,
        hasMask: false,
      }).id,
    ).toBe("bfl/flux-2-pro");
  });

  it("auto: edit mode without any image falls back to creating", () => {
    const picked = pickImageModel({
      requestedModelId: AUTO_IMAGE_MODEL_ID,
      mode: "edit",
      imageCount: 0,
      hasMask: false,
    });
    expect(picked.id).toBe(DEFAULT_IMAGE_MODEL_ID);
  });
});

describe("catalog", () => {
  it("keeps the mask-only model out of the submenu", () => {
    expect(SELECTABLE_IMAGE_MODELS.some((m) => m.hidden)).toBe(false);
    expect(IMAGE_MODELS.some((m) => m.id === "bfl/flux-pro-1.0-fill")).toBe(
      true,
    );
  });

  it("resolves the auto sentinel and unknown ids to the default", () => {
    expect(resolveImageModel(AUTO_IMAGE_MODEL_ID).id).toBe(
      DEFAULT_IMAGE_MODEL_ID,
    );
    expect(resolveImageModel("google").id).toBe(DEFAULT_IMAGE_MODEL_ID);
  });
});

/**
 * Image generation models available via Vercel AI Gateway.
 *
 * Shared between the client (model selector) and the server (image tool,
 * generation, billing) — keep this module free of server-only imports.
 *
 * Every entry's `id` must have a matching price entry in the billing price
 * table (`LLM_PRICES`), or billing falls back to the token floor and per-image
 * cost is lost. `image-models-billing-coverage.test.ts` enforces it.
 */

export interface ImageModelCapabilities {
  /** Text-to-image without any input image. */
  create: boolean;
  /** Instruction edits of one input image, preserving its identity. */
  edit: boolean;
  /** Several input images combined or used as references. */
  multiReference: boolean;
  /** Mask-based inpainting: only the white region of the mask is regenerated. */
  mask: boolean;
}

export interface ImageModelDefinition {
  /** AI Gateway model id — also the billing id in `LLM_PRICES`. */
  id: string;
  /** Display name shown in the selector and on the result card. */
  name: string;
  provider: "google" | "openai" | "bfl";
  /**
   * How the gateway exposes the model:
   * - "chat": multimodal language model (generateText + responseModalities).
   *   Accepts conversation context including images, so edit/composite work.
   * - "image": dedicated image API (generateImage). Takes a text prompt plus
   *   optional input images and a mask (see `capabilities`).
   */
  api: "chat" | "image";
  capabilities: ImageModelCapabilities;
  /**
   * Not offered in the model submenu. Automatic selection may still pick it
   * (the mask-only inpainting model is useless as a manual choice because it
   * needs a mask the menu cannot supply).
   */
  hidden?: boolean;
}

export const IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: "google/gemini-2.5-flash-image",
    name: "Gemini 2.5 Flash Image",
    provider: "google",
    api: "chat",
    capabilities: {
      create: true,
      edit: true,
      multiReference: true,
      mask: false,
    },
  },
  {
    id: "google/gemini-3.1-flash-image-preview",
    name: "Nano Banana 2",
    provider: "google",
    api: "chat",
    capabilities: {
      create: true,
      edit: true,
      multiReference: true,
      mask: false,
    },
  },
  {
    id: "openai/gpt-image-2",
    name: "GPT Image 2",
    provider: "openai",
    api: "image",
    capabilities: {
      create: true,
      edit: true,
      multiReference: true,
      mask: false,
    },
  },
  {
    id: "bfl/flux-2-pro",
    name: "FLUX.2 Pro",
    provider: "bfl",
    api: "image",
    capabilities: {
      create: true,
      edit: true,
      multiReference: true,
      mask: false,
    },
  },
  {
    id: "bfl/flux-kontext-pro",
    name: "FLUX.1 Kontext Pro",
    provider: "bfl",
    api: "image",
    capabilities: {
      create: true,
      edit: true,
      multiReference: false,
      mask: false,
    },
  },
  {
    id: "bfl/flux-pro-1.0-fill",
    name: "FLUX.1 Fill Pro",
    provider: "bfl",
    api: "image",
    capabilities: {
      create: false,
      edit: true,
      multiReference: false,
      mask: true,
    },
    hidden: true,
  },
];

export const DEFAULT_IMAGE_MODEL_ID = "google/gemini-2.5-flash-image";

/**
 * Sentinel the composer sends when the user leaves the choice to the app.
 * `pickImageModel` turns it into a concrete model at execution time, from
 * what the turn actually contains (mask, number of input images, mode).
 */
export const AUTO_IMAGE_MODEL_ID = "auto";

/** Models the submenu offers for a manual pick, in catalog order. */
export const SELECTABLE_IMAGE_MODELS = IMAGE_MODELS.filter((m) => !m.hidden);

export const isAutoImageModel = (modelId?: string | null): boolean =>
  !modelId || modelId === AUTO_IMAGE_MODEL_ID;

/**
 * Fail-closed model lookup: unknown ids (including the legacy "google"
 * provider string older clients still send, and the "auto" sentinel) resolve
 * to the default model.
 */
export const resolveImageModel = (modelId?: string): ImageModelDefinition =>
  IMAGE_MODELS.find((m) => m.id === modelId) ??
  IMAGE_MODELS.find((m) => m.id === DEFAULT_IMAGE_MODEL_ID)!;

const byId = (id: string): ImageModelDefinition =>
  IMAGE_MODELS.find((m) => m.id === id)!;

export type ImageGenerationMode = "create" | "edit" | "composite";

export interface PickImageModelInput {
  /** What the composer sent: a concrete id, "auto", or nothing. */
  requestedModelId?: string | null;
  /** Operation the chat model asked the tool for. */
  mode: ImageGenerationMode;
  /** Input images the turn carries (uploads plus the last generated image). */
  imageCount: number;
  /** A brush mask was drawn on the source photo. */
  hasMask: boolean;
}

/**
 * Chooses the model for one generation. The rules are deterministic and live
 * here, not in the system prompt: the chat model only decides `mode`, which
 * the tool schema already asks for.
 *
 * - A mask always goes to the inpainting model. Nothing else on the gateway
 *   honours a mask, so a manual pick would silently regenerate the whole
 *   image instead of the marked region.
 * - A manual pick otherwise wins, even when it is a poor fit.
 * - "auto": edit with one image -> Kontext (identity-preserving); edit or
 *   composite with several -> FLUX.2 Pro (multi-reference); create -> the
 *   default (cheapest) model.
 */
export function pickImageModel(
  input: PickImageModelInput,
): ImageModelDefinition {
  if (input.hasMask) return byId("bfl/flux-pro-1.0-fill");

  if (!isAutoImageModel(input.requestedModelId)) {
    const requested = IMAGE_MODELS.find(
      (m) => m.id === input.requestedModelId && !m.hidden,
    );
    if (requested) return requested;
  }

  if (input.imageCount === 0) return resolveImageModel(DEFAULT_IMAGE_MODEL_ID);
  if (input.mode === "composite" || input.imageCount > 1) {
    return byId("bfl/flux-2-pro");
  }
  if (input.mode === "edit") return byId("bfl/flux-kontext-pro");
  return resolveImageModel(DEFAULT_IMAGE_MODEL_ID);
}

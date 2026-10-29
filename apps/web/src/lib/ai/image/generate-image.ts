"use server";
import { ModelMessage, generateImage, generateText } from "ai";
import logger from "logger";
import { aiTelemetry } from "lib/ai/telemetry";
import { resolveImageApiText } from "./fill-prompt";
import type { ImageInput } from "./image-inputs";
import { resolveImageModel } from "./image-models";

type GenerateImageOptions = {
  messages?: ModelMessage[];
  prompt: string;
  abortSignal?: AbortSignal;
  /**
   * Image model id from `IMAGE_MODELS`; unknown or absent ids fall back to
   * the default model.
   */
  modelId?: string;
  /**
   * Input images for dedicated image-API models (`api: "image"`), as URL
   * strings or bytes (see `ImageInput`). Chat-style models read their images
   * from `messages` instead. Oldest first; the newest is the one an edit
   * instruction most likely refers to.
   */
  images?: ImageInput[];
  /**
   * Inpainting mask for models with `capabilities.mask`: white marks the
   * region to regenerate, black is kept. Applies to the last of `images`.
   */
  mask?: ImageInput;
};

type GeneratedImage = {
  base64: string;
  mimeType?: string;
};

export type GeneratedImageResult = {
  images: GeneratedImage[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

/**
 * Generate images via AI Gateway with the given image model.
 *
 * Multimodal chat models (Gemini image family) get the full message context so
 * they can edit/composite existing images; dedicated image-API models
 * (GPT Image 2, FLUX) take the latest instruction as text plus the context's
 * images as explicit inputs — without them an "edit" silently became a fresh
 * generation from the prompt alone.
 */
export const generateImageWithModel = async (
  options: GenerateImageOptions,
): Promise<GeneratedImageResult> => {
  const model = resolveImageModel(options.modelId);
  try {
    if (model.api === "image") {
      const text = resolveImageApiText({
        prompt: options.prompt,
        messages: options.messages,
        hasMask: Boolean(options.mask),
      });
      const images = options.images ?? [];
      const hasInputs = images.length > 0;

      logger.info(
        `[Image Gen] Generating image via AI Gateway image API with ${model.id} (${images.length} input images${options.mask ? ", mask" : ""})`,
      );

      const result = await generateImage({
        model: model.id,
        prompt: hasInputs
          ? {
              // `text` is optional on the image API. Omitting it on a masked
              // call means "fill this region from its surroundings", which is
              // the right answer when there is nothing useful to say; an empty
              // string would be a prompt describing nothing.
              ...(text ? { text } : {}),
              images,
              ...(options.mask ? { mask: options.mask } : {}),
            }
          : text,
        n: 1,
        // A fixed size keeps the per-image billing rate deterministic for
        // text-to-image (see the model's entry in the billing price table, `LLM_PRICES`).
        // Edits deliberately omit it: the output has to keep the source
        // photo's aspect ratio, and the providers default to matching it.
        ...(hasInputs || model.provider !== "openai"
          ? {}
          : { size: "1024x1024" as const }),
        abortSignal: options.abortSignal,
      });

      return {
        images: result.images.map((image) => ({
          base64: image.base64,
          mimeType: image.mediaType,
        })),
        // Image-API models bill per image, not per token (see llm-prices.ts).
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    }

    // Build messages array
    const messages: ModelMessage[] = [...(options.messages || [])];

    // Add prompt as final user message if provided
    if (options.prompt) {
      messages.push({
        role: "user",
        content: options.prompt,
      });
    }

    logger.info(
      `[Image Gen] Generating image via AI Gateway with ${model.id} and ${messages.length} messages`,
    );

    const result = await generateText({
      model: model.id,
      experimental_telemetry: aiTelemetry("image.generate", {
        modelId: model.id,
      }),
      providerOptions: {
        google: {
          // Gemini image models reject image-only responses — TEXT must be
          // requested alongside IMAGE or the call returns no image files.
          responseModalities: ["TEXT", "IMAGE"],
        },
      },
      messages,
      abortSignal: options.abortSignal,
      // Note: Token tracking happens via the tool's onFinish callback
      // in the main chat route, not here
    });

    logger.info(`[Image Gen] Generated ${result.files?.length || 0} files`);

    // Extract images from result.files
    const imageFiles =
      result.files?.filter((f) => f.mediaType?.startsWith("image/")) || [];

    const images: GeneratedImage[] = imageFiles.map((file) => ({
      base64: Buffer.from(file.uint8Array).toString("base64"),
      mimeType: file.mediaType,
    }));

    return {
      images,
      usage: {
        inputTokens: result.usage?.inputTokens || 0,
        outputTokens: result.usage?.outputTokens || 0,
        totalTokens: result.usage?.totalTokens || 0,
      },
    };
  } catch (err) {
    logger.error("[Image Gen] Failed to generate image:", err);
    throw err;
  }
};

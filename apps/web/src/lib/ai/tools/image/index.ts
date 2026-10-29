import { trackUsage } from "@/lib/gate";
import { tool as createTool } from "ai";
import { fetchImageBytes } from "lib/ai/image/fetch-image-bytes";
import { toFillPrompt } from "lib/ai/image/fill-prompt";
import { sanitizeImagePrompt } from "lib/ai/image/image-inputs";
import { generateImageWithModel } from "lib/ai/image/generate-image";
import {
  type NormalizedMaskedPair,
  normalizeMaskedPair,
} from "lib/ai/image/normalize-masked-pair";
import { pickImageModel } from "lib/ai/image/image-models";
import { serverFileStorage } from "lib/file-storage";
import logger from "logger";
import { safe, watchError } from "ts-safe";
import { z } from "zod";
import {
  buildImageModelContext,
  extractImageInputs,
  type ImageToolResult,
} from "./image-context";

export type { ImageToolResult } from "./image-context";

/** A brush mask the composer drew over one uploaded image. */
export type ImageMaskInput = {
  /** The uploaded photo the mask belongs to. */
  imageUrl: string;
  /** PNG of the same size: white = regenerate, black = keep. */
  maskUrl: string;
};

/**
 * Factory function to create image generation tool with userId and threadId bound
 * Image generation via AI Gateway with the user-selected image model
 * Automatically tracks token usage through the billing gate
 *
 * `modelId` may be a concrete catalog id, the "auto" sentinel, or absent; the
 * concrete model is picked at execution time (`pickImageModel`) from the mode
 * the chat model asks for, the images the turn carries, and whether a mask
 * was drawn.
 */
export const createImageTool = (
  billingCustomerId?: string | null,
  threadId?: string,
  billingEntityId?: string,
  modelId?: string,
  mask?: ImageMaskInput | null,
) => {
  // The chat model cannot see the mask; without this it reads "the mask" in
  // the user's words as an object in the photo and picks the wrong mode.
  const maskNote = mask
    ? " A brush mask is attached to the user's uploaded photo: when the user says 'the mask', 'the marked area' or similar, they mean that painted region, and the edit will change only that region. Use mode 'edit', set 'maskAction', and write a 'prompt' that describes the painted region as it should look when the edit is done."
    : "";
  return createTool({
    description: `Generate, edit, or composite images based on the conversation context.${maskNote} This tool automatically analyzes recent messages to create images without requiring explicit input parameters. It includes user-uploaded images from the conversation and only the most recent AI-generated image to avoid confusion. Use the 'mode' parameter to specify the operation type: 'create' for new images, 'edit' for modifying existing images, or 'composite' for combining multiple images. Choose 'edit' whenever the user refers to an image they uploaded or one generated earlier in this thread, even for small changes; the app picks the concrete image model itself. Use this when the user requests image creation, modification, or visual content generation.`,
    inputSchema: z.object({
      mode: z
        .enum(["create", "edit", "composite"])
        .optional()
        .default("create")
        .describe(
          "Image generation mode: 'create' for new images, 'edit' for modifying existing images, 'composite' for combining multiple images",
        ),
      // Nullable rather than optional: an optional field here collapses the
      // AI SDK's input inference for the whole schema.
      prompt: z
        .string()
        .nullable()
        .describe(promptGuidance(Boolean(mask))),
      maskAction: z
        .enum(["remove", "replace"])
        .nullable()
        .describe(
          "Only when a brush mask is attached, otherwise null. 'remove' when the user wants what is under the mask gone, 'replace' when they want something else in its place.",
        ),
    }),
    execute: async (
      { mode: requestedMode, prompt: requestedPrompt, maskAction },
      options,
    ) => {
      const { messages, abortSignal, toolCallId } = options;
      try {
        const latestMessages = buildImageModelContext(messages);

        // A mask pins the edit to exactly one photo: the other images in the
        // thread would only dilute what the inpainting model regenerates.
        // Both go as bytes: the inpainting provider takes the mask as base64
        // and rejects a URL ("Invalid mask data"), whereas plain edits can
        // hand the provider our public storage URLs. The pair is resized
        // together — an unscaled upload is both too big to send and a
        // dimension mismatch for the mask.
        let maskedPair: NormalizedMaskedPair | undefined;
        if (mask) {
          try {
            const [photoBytes, maskBytes] = await Promise.all([
              fetchImageBytes(mask.imageUrl),
              fetchImageBytes(mask.maskUrl),
            ]);
            maskedPair = await normalizeMaskedPair(photoBytes, maskBytes);
          } catch (error) {
            // Thrown, this fails the same way on every retry and the chat
            // model keeps calling the tool. Reported as a result, it stops.
            logger.error("[Image Tool] Mask preparation failed:", error);
            return maskFailureResult(error);
          }
        }
        const images = maskedPair
          ? [maskedPair.image]
          : extractImageInputs(latestMessages);
        const maskInput = maskedPair?.mask;
        const mode = mask ? "edit" : requestedMode;

        const imageModel = pickImageModel({
          requestedModelId: modelId,
          mode,
          imageCount: images.length,
          hasMask: Boolean(mask),
        });

        // A fill model paints whatever the prompt describes into the masked
        // region, so an instruction ("remove the heading") reaches it as
        // something to draw. See `toFillPrompt`.
        const prompt = mask
          ? toFillPrompt(requestedPrompt ?? "", maskAction)
          : sanitizeImagePrompt(requestedPrompt ?? "");
        logger.info(
          `[Image Tool] Generating image with ${imageModel.id} (requested: ${modelId ?? "auto"}, mode: ${mode}, images: ${images.length}${mask ? `, masked: ${maskAction ?? "unset"}` : ""}) and ${latestMessages.length} context messages, prompt: ${JSON.stringify(prompt.slice(0, 120))}`,
        );

        // Generate image via AI Gateway (with automatic usage tracking)
        const imageResult = await generateImageWithModel({
          modelId: imageModel.id,
          // The model's own wording wins: the raw user turn also carries the
          // attachment list and ingestion blocks the app injected, which an
          // image model reads as things to draw.
          prompt,
          abortSignal,
          messages: latestMessages,
          images,
          mask: maskInput,
        });

        // Track usage for billing: token-priced models report usage, image-API
        // models bill per generated image (see perImageUSD in llm-prices.ts)
        if (billingCustomerId) {
          const { inputTokens = 0, outputTokens = 0 } = imageResult.usage ?? {};
          logger.info(
            `[Image Tool] Tracking usage - Input: ${inputTokens}, Output: ${outputTokens}, Images: ${imageResult.images.length}`,
          );

          try {
            await trackUsage({
              kind: "tokens",
              customerId: billingCustomerId,
              entityId: billingEntityId,
              modelId: imageModel.id,
              promptTokens: inputTokens,
              completionTokens: outputTokens,
              imageCount: imageResult.images.length,
              idempotencyKey: `image-${billingCustomerId}-${toolCallId}`,
              properties: {
                threadId: threadId,
                imageGeneration: true,
                mode: mode,
                masked: Boolean(mask),
              },
            });
            logger.info(`[Image Tool] Token usage tracked successfully`);
          } catch (err) {
            logger.error("[Image Tool] Failed to track token usage:", err);
          }
        }

        // Upload generated images to storage
        const resultImages = await safe(imageResult.images)
          .map((images) => {
            return Promise.all(
              images.map(async (image) => {
                const uploadedImage = await serverFileStorage.upload(
                  Buffer.from(image.base64, "base64"),
                  {
                    contentType: image.mimeType,
                    filename: `ai-generated-${Date.now()}.png`,
                    userId: billingCustomerId ?? undefined,
                    uploadType: "ai-generated",
                  },
                );
                return {
                  url: uploadedImage.sourceUrl,
                  mimeType: image.mimeType,
                };
              }),
            );
          })
          .watch(
            watchError((e) => {
              logger.error(e);
              logger.info(`upload image failed. using base64`);
            }),
          )
          .ifFail(() => {
            throw new Error(
              "Image generation was successful, but file upload failed. Please check your file upload configuration and try again.",
            );
          })
          .unwrap();

        return {
          images: resultImages,
          mode,
          model: imageModel.name,
          modelId: imageModel.id,
          masked: Boolean(mask),
          guide:
            resultImages.length > 0
              ? "The image has been successfully generated and is now displayed above. If you need any edits, modifications, or adjustments to the image, please let me know."
              : "I apologize, but the image generation was not successful. To help me create a better image for you, could you please provide more specific details about what you'd like to see? For example:\n\n• What style are you looking for? (realistic, cartoon, abstract, etc.)\n• What colors or mood should the image have?\n• Are there any specific objects, people, or scenes you want included?\n• What size or format would work best for your needs?\n\nPlease share these details and I'll try generating the image again with your specifications.",
        };
      } catch (e) {
        logger.error(e);
        throw e;
      }
    },
  });
};

/** True of every image model: it paints each word it is given, verbatim. */
const NOTHING_EXTRA =
  "Leave out file names, URLs, and anything the user did not ask to see: an image model paints what the prompt says, so a file name in it is painted into the picture.";

/**
 * How the `prompt` field is described to the chat model.
 *
 * The masked variant is the important one. Inpainting runs on FLUX Fill, which
 * does not follow instructions — it regenerates the painted region to match
 * the prompt. "Remove the heading \"SALE\"" therefore paints a heading reading
 * SALE, which is what users reported as "the text is still there, just in a
 * different font". Describing the finished region instead is the only phrasing
 * that removes anything.
 */
function promptGuidance(hasMask: boolean): string {
  if (!hasMask) {
    return `What the image should show, in plain words, as the user meant it. ${NOTHING_EXTRA} Pass null only when the user's own last message already reads as an image description.`;
  }
  return `Describe the masked region as it should LOOK once the edit is done - the surface or scene that fills it, as a short phrase: "plain white background", "smooth grey concrete wall", "blue sky with thin clouds". This model paints whatever the prompt describes into that region and follows no instructions, so never write "remove", "delete", "erase" or "without", and never name or quote the thing that should disappear - naming it paints it straight back. To take something away, describe only what is behind and around it. To put something there, describe that thing and nothing else. ${NOTHING_EXTRA}`;
}

/**
 * What the chat model is told when the masked photo cannot be prepared.
 *
 * A thrown error reaches the model as a tool failure, which it answers by
 * calling the tool again — ten identical failures in a row, each one another
 * download of the same oversized photo. A result ends the loop and lets the
 * model say something useful.
 */
function maskFailureResult(
  error: unknown,
): ImageToolResult & { error: string } {
  const reason =
    error instanceof Error
      ? error.message
      : "The masked photo could not be read.";
  return {
    images: [],
    mode: "edit",
    model: "",
    masked: true,
    error: reason,
    guide: `The masked photo could not be prepared for editing: ${reason} Do not call this tool again for it. Tell the user what happened and ask them to upload a smaller image or remove the mask.`,
  };
}

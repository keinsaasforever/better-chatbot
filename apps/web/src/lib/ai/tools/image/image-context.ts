import { FilePart, ModelMessage, ToolResultPart, UserContent } from "ai";
import { type ImageInput, toImageInput } from "lib/ai/image/image-inputs";
import { toAny } from "lib/utils";
import { ImageToolName } from "..";

export {
  extractLatestUserText,
  toImageInput,
  type ImageInput,
} from "lib/ai/image/image-inputs";

export type ImageToolResult = {
  images: {
    url: string;
    mimeType?: string;
  }[];
  mode?: "create" | "edit" | "composite";
  guide?: string;
  model: string;
  /** Gateway id of the model that actually ran (chosen at execution time). */
  modelId?: string;
  /** True when a brush mask limited the edit to a region of the source. */
  masked?: boolean;
  /** Set instead of images when the request could not be prepared at all. */
  error?: string;
};

/** Text turns (user + assistant) handed to the image model, newest first. */
export const MAX_CONTEXT_TEXT_TURNS = 6;
/**
 * Uploaded images kept from the whole thread. The source photo of a renovation
 * is usually uploaded once and then edited over many turns, so it must not age
 * out with the text window; the cap bounds cost when a thread carries many.
 */
export const MAX_CONTEXT_USER_IMAGES = 4;

/**
 * Build the conversation context handed to the image model.
 *
 * The chat history contains assistant `tool-call` parts and `tool`-role result
 * messages from earlier turns. Image models reject those: a tool call without
 * its paired result (or vice versa) fails provider validation, which is why
 * every generation after the first in a thread used to error. So the context
 * is rebuilt from scratch: user messages pass through, assistant messages are
 * reduced to their text, and of the tool results only the most recent
 * generated image survives — re-attached as a user image so it can be edited.
 *
 * Text is windowed to the last `MAX_CONTEXT_TEXT_TURNS` turns. Uploaded images
 * are not: the newest `MAX_CONTEXT_USER_IMAGES` of them are kept wherever they
 * sit in the thread, so a photo uploaded at the start still reaches the model
 * on the tenth edit.
 */
export function buildImageModelContext(
  messages: ModelMessage[],
): ModelMessage[] {
  let hasFoundImage = false;
  let textTurns = 0;
  let userImages = 0;
  const seenImages = new Set<string>();
  const context: ModelMessage[] = [];

  // Walk newest-first so "the most recent generated image" wins; including
  // older generated images alongside it confuses the image model.
  for (const message of [...messages].reverse()) {
    if (message.role === "user") {
      const withinWindow = textTurns < MAX_CONTEXT_TEXT_TURNS;

      if (typeof message.content === "string") {
        if (message.content && withinWindow) {
          context.push(message);
          textTurns++;
        }
        continue;
      }

      const keptImages: FilePart[] = [];
      const otherParts: Exclude<UserContent, string> = [];
      for (const part of message.content) {
        if (!isImageFilePart(part)) {
          otherParts.push(part);
          continue;
        }
        const key = imageKey(part);
        if (key && seenImages.has(key)) continue;
        if (userImages >= MAX_CONTEXT_USER_IMAGES) continue;
        if (key) seenImages.add(key);
        userImages++;
        keptImages.push(part);
      }

      if (withinWindow) {
        const content = [...otherParts, ...keptImages];
        if (content.length > 0) {
          context.push({ role: "user", content });
          textTurns++;
        }
      } else if (keptImages.length > 0) {
        // Outside the text window only the images matter; the words around
        // them were about an earlier request.
        context.push({ role: "user", content: keptImages });
      }
      continue;
    }

    if (message.role === "assistant") {
      if (textTurns >= MAX_CONTEXT_TEXT_TURNS) continue;
      const content =
        typeof message.content === "string"
          ? message.content
          : message.content.filter((part) => part.type === "text");
      const isEmpty = typeof content === "string" ? !content : !content.length;
      if (!isEmpty) {
        context.push({ role: "assistant", content });
        textTurns++;
      }
      continue;
    }

    if (message.role === "tool") {
      if (hasFoundImage) continue;
      const fileParts = message.content.flatMap(
        convertToImageToolPartToFilePart,
      );
      if (fileParts.length === 0) continue;
      hasFoundImage = true;
      context.push({ role: "user", content: fileParts });
    }
    // system messages are dropped — the image model gets no instructions
  }

  return context.reverse();
}

/**
 * Every image in the built context, oldest first, in the form the dedicated
 * image APIs take. Uploads are public storage URLs and the re-attached
 * generated image is one too, so URLs are passed through rather than
 * downloaded; the gateway fetches them.
 */
export function extractImageInputs(context: ModelMessage[]): ImageInput[] {
  const inputs: ImageInput[] = [];
  for (const message of context) {
    if (message.role !== "user" || typeof message.content === "string") {
      continue;
    }
    for (const part of message.content) {
      if (!isImageFilePart(part)) continue;
      const input = toImageInput(part.data);
      if (input) inputs.push(input);
    }
  }
  return inputs;
}

function isImageFilePart(part: { type: string }): part is FilePart {
  return (
    part.type === "file" &&
    typeof (part as FilePart).mediaType === "string" &&
    (part as FilePart).mediaType.startsWith("image/")
  );
}

function imageKey(part: FilePart): string | undefined {
  const data = part.data;
  if (typeof data === "string") return data;
  if (data instanceof URL) return data.toString();
  return undefined;
}

function convertToImageToolPartToFilePart(
  part: ToolResultPart | { type: string },
): FilePart[] {
  if (!("toolName" in part)) return [];
  if (part.toolName !== ImageToolName) return [];
  const output = toAny(part).output;
  // In AI SDK 6, output can be either the value directly or wrapped with type
  const result = (output?.value || output) as ImageToolResult;
  if (!result?.images?.length) return [];
  return result.images.map((image) => ({
    type: "file",
    mediaType: image.mimeType!,
    data: image.url,
  }));
}

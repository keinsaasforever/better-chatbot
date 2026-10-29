import { isAllowedImageSourceUrl } from "./image-inputs";

/**
 * Hard cap for one downloaded image.
 *
 * This is a memory guard, not the provider's limit: what we send is resized
 * first (see `normalizeMaskedPair`), so a 30 MB phone photo is editable. Only
 * something no camera produces is refused.
 */
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

/**
 * Downloads one of our own storage objects so it can be sent to an image API
 * as inline bytes.
 *
 * Needed for inpainting: BFL's Fill endpoint takes the mask (and the image it
 * belongs to) as base64, and the gateway forwards a URL-typed mask unchanged,
 * which the provider answers with "Invalid mask data". Bytes go through as a
 * base64 file part instead. Only our storage origin is fetched, since the
 * URLs come from the client.
 */
export async function fetchImageBytes(url: string): Promise<Uint8Array> {
  if (!isAllowedImageSourceUrl(url, process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    throw new Error("Image URL is not from the app's storage.");
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`Image download failed (${response.status}).`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error("Image URL did not return an image.");
  }
  const tooLarge = `Image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`;
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) {
    throw new Error(tooLarge);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(tooLarge);
  }
  return bytes;
}

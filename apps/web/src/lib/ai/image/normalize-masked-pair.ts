import { Buffer } from "node:buffer";
import logger from "logger";

/**
 * Long edge the inpainting pair is scaled down to before it is sent.
 *
 * A phone photo is 12-24 MP and tens of megabytes once base64-encoded, which
 * the provider rejects outright; FLUX Fill also works around 1 MP, so the
 * extra pixels buy nothing but latency and a failed request. 1536 keeps a
 * 4:3 photo at ~1.8 MP, enough that the untouched part of the image still
 * looks like the original.
 */
export const INPAINT_TARGET_LONG_EDGE = 1536;

/**
 * FLUX works in 32-pixel blocks and rounds anything else itself. Rounding
 * here instead keeps the photo and the mask on the same grid: the provider
 * compares their dimensions and answers a mismatch with "Invalid mask data".
 */
const BLOCK = 32;

/**
 * Above this, the photo goes as JPEG instead of PNG.
 *
 * Flat images — screenshots, logos, anything with text — stay lossless and
 * compress well below it. A photograph does not: its PNG runs to several
 * megabytes that become a third more again as base64, for a difference the
 * model cannot see.
 */
const MAX_PNG_BYTES = 1_500_000;

/** JPEG quality, on the encoder's 0-100 scale (0.9 there means 0.9%). */
const JPEG_QUALITY = 90;

/**
 * Formats the native decoder is known to read.
 *
 * It is checked before anything is handed over because a decode failure there
 * is a Rust panic, which aborts the process instead of throwing — a corrupt
 * upload would take the whole request down. HEIC is deliberately absent: an
 * iPhone photo that was never converted gets a message saying so.
 */
const MAGIC: { name: string; bytes: number[]; offset?: number }[] = [
  { name: "png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: "jpeg", bytes: [0xff, 0xd8, 0xff] },
  { name: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: "webp", bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
];

const startsWith = (bytes: Uint8Array, magic: number[], offset = 0): boolean =>
  magic.every((byte, index) => bytes[offset + index] === byte);

/** Throws unless the bytes carry the signature of a format we can decode. */
export function assertDecodableImage(bytes: Uint8Array, label: string): void {
  if (bytes.byteLength < 16) {
    throw new Error(`The ${label} is empty or truncated.`);
  }
  if (MAGIC.some((m) => startsWith(bytes, m.bytes, m.offset))) return;
  // ISO-BMFF ("ftyp" at offset 4) is HEIC/HEIF territory.
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    throw new Error(
      `The ${label} is a HEIC image; save it as JPEG or PNG and upload it again.`,
    );
  }
  throw new Error(`The ${label} is not a PNG, JPEG, WebP or GIF image.`);
}

export type NormalizedMaskedPair = {
  /** The photo, scaled to `width` x `height`. */
  image: Uint8Array;
  /** Binary PNG mask at exactly the same size: white = regenerate. */
  mask: Uint8Array;
  width: number;
  height: number;
};

const snapToBlock = (value: number): number =>
  Math.max(BLOCK, Math.round(value / BLOCK) * BLOCK);

/** Target size for one inpainting request: never upscales, always on the grid. */
export function inpaintTargetSize(
  width: number,
  height: number,
  maxLongEdge: number = INPAINT_TARGET_LONG_EDGE,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (!Number.isFinite(longEdge) || longEdge <= 0) {
    throw new Error("Image has no usable dimensions.");
  }
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
  return {
    width: snapToBlock(width * scale),
    height: snapToBlock(height * scale),
  };
}

/**
 * Bring a photo and its brush mask into the shape the inpainting API takes:
 * both at identical dimensions, small enough to send, and the mask strictly
 * black and white.
 *
 * The mask is drawn in the browser at whatever resolution the composer could
 * afford, and the photo is whatever the user uploaded, so neither the sizes
 * nor the byte count can be trusted. Resizing both to one computed size is
 * what makes the pair valid — scaling the mask stretches its strokes exactly
 * like the photo, so the painted region still covers the same content.
 */
export async function normalizeMaskedPair(
  imageBytes: Uint8Array,
  maskBytes: Uint8Array,
): Promise<NormalizedMaskedPair> {
  assertDecodableImage(imageBytes, "photo");
  assertDecodableImage(maskBytes, "mask");

  // Lazily imported: a native binding that most chat turns never need.
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");

  const [photo, painted] = await Promise.all([
    loadImage(Buffer.from(imageBytes)),
    loadImage(Buffer.from(maskBytes)),
  ]);

  const { width, height } = inpaintTargetSize(photo.width, photo.height);

  const imageCanvas = createCanvas(width, height);
  imageCanvas.getContext("2d").drawImage(photo, 0, 0, width, height);
  let image = imageCanvas.toBuffer("image/png");
  if (image.byteLength > MAX_PNG_BYTES) {
    image = imageCanvas.toBuffer("image/jpeg", JPEG_QUALITY);
  }

  const maskCanvas = createCanvas(width, height);
  const maskCtx = maskCanvas.getContext("2d");
  maskCtx.drawImage(painted, 0, 0, width, height);
  const scaled = maskCtx.getImageData(0, 0, width, height);
  // Scaling feathers the stroke edges into grey; the provider wants a binary
  // mask, so every pixel is pushed back to black or white.
  for (let i = 0; i < scaled.data.length; i += 4) {
    const on = scaled.data[i]! > 127 ? 255 : 0;
    scaled.data[i] = on;
    scaled.data[i + 1] = on;
    scaled.data[i + 2] = on;
    scaled.data[i + 3] = 255;
  }
  maskCtx.putImageData(scaled, 0, 0);
  const mask = maskCanvas.toBuffer("image/png");

  logger.info(
    `[Image Gen] Inpainting pair normalized to ${width}x${height} (image ${image.byteLength} bytes, mask ${mask.byteLength} bytes)`,
  );

  return {
    image: new Uint8Array(image),
    mask: new Uint8Array(mask),
    width,
    height,
  };
}

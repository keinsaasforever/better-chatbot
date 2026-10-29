import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  inpaintTargetSize,
  normalizeMaskedPair,
} from "./normalize-masked-pair";

/** A solid PNG of the given size, with an optional white box to find again. */
function png(
  width: number,
  height: number,
  box?: { x: number; y: number; w: number; h: number },
): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  if (box) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  return new Uint8Array(canvas.toBuffer("image/png"));
}

describe("inpaintTargetSize", () => {
  it("scales a phone photo down to the target long edge", () => {
    const { width, height } = inpaintTargetSize(4032, 3024);
    expect(Math.max(width, height)).toBeLessThanOrEqual(1536);
    // 4:3 is kept within the 32-pixel grid it snaps to.
    expect(width / height).toBeCloseTo(4 / 3, 1);
  });

  it("never upscales a small image", () => {
    expect(inpaintTargetSize(320, 320)).toEqual({ width: 320, height: 320 });
  });

  it("snaps both edges onto the 32-pixel grid", () => {
    const { width, height } = inpaintTargetSize(1001, 667);
    expect(width % 32).toBe(0);
    expect(height % 32).toBe(0);
  });

  it("rejects an image with no dimensions", () => {
    expect(() => inpaintTargetSize(0, 0)).toThrow();
  });
});

describe("normalizeMaskedPair", () => {
  it("returns a photo and mask at identical, downscaled dimensions", async () => {
    const pair = await normalizeMaskedPair(
      png(4032, 3024),
      // The composer caps the mask, so it arrives smaller than the photo.
      png(1536, 1152, { x: 0, y: 0, w: 768, h: 1152 }),
    );

    const expected = inpaintTargetSize(4032, 3024);
    expect({ width: pair.width, height: pair.height }).toEqual(expected);
    expect(pair.image.byteLength).toBeGreaterThan(0);

    const { loadImage } = await import("@napi-rs/canvas");
    for (const bytes of [pair.image, pair.mask]) {
      const decoded = await loadImage(Buffer.from(bytes));
      expect([decoded.width, decoded.height]).toEqual([
        expected.width,
        expected.height,
      ]);
    }
  });

  it("keeps the mask strictly black and white after scaling", async () => {
    const pair = await normalizeMaskedPair(
      png(2048, 2048),
      png(2048, 2048, { x: 100, y: 100, w: 313, h: 313 }),
    );

    const { loadImage } = await import("@napi-rs/canvas");
    const decoded = await loadImage(Buffer.from(pair.mask));
    const canvas = createCanvas(decoded.width, decoded.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(decoded, 0, 0);
    const { data } = ctx.getImageData(0, 0, decoded.width, decoded.height);

    let white = 0;
    let grey = 0;
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i];
      if (value === 255) white++;
      else if (value !== 0) grey++;
    }
    expect(grey).toBe(0);
    expect(white).toBeGreaterThan(0);
  });

  it("falls back to JPEG when the photo is too heavy as PNG", async () => {
    // Noise is the worst case for PNG, the way a photograph is.
    const canvas = createCanvas(2400, 1800);
    const ctx = canvas.getContext("2d");
    const noise = ctx.createImageData(2400, 1800);
    for (let i = 0; i < noise.data.length; i += 4) {
      noise.data[i] = (i * 7) % 256;
      noise.data[i + 1] = (i * 13) % 256;
      noise.data[i + 2] = (i * 29) % 256;
      noise.data[i + 3] = 255;
    }
    ctx.putImageData(noise, 0, 0);
    const photo = new Uint8Array(canvas.toBuffer("image/png"));

    const pair = await normalizeMaskedPair(photo, png(1536, 1152));

    expect(pair.image.byteLength).toBeLessThan(1_500_000);
    const { loadImage } = await import("@napi-rs/canvas");
    const decoded = await loadImage(Buffer.from(pair.image));
    expect([decoded.width, decoded.height]).toEqual([pair.width, pair.height]);
  });

  it("rejects bytes that are not an image before they reach the decoder", async () => {
    // The native decoder panics on junk, which would abort the request, so
    // this must be caught by the signature check.
    await expect(
      normalizeMaskedPair(new Uint8Array(32).fill(7), png(64, 64)),
    ).rejects.toThrow(/not a PNG/);
  });

  it("names HEIC as the problem when an unconverted iPhone photo arrives", async () => {
    const heic = new Uint8Array(32);
    heic.set([0x66, 0x74, 0x79, 0x70], 4);
    await expect(normalizeMaskedPair(heic, png(64, 64))).rejects.toThrow(
      /HEIC/,
    );
  });
});

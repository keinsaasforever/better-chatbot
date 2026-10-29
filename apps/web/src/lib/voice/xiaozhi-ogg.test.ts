import { describe, expect, it } from "vitest";
import { createOggOpusBuffer } from "./xiaozhi-ogg";

describe("createOggOpusBuffer", () => {
  it("wraps raw Opus packets in Ogg pages", () => {
    const audio = createOggOpusBuffer({
      packets: [new Uint8Array([0xf8, 0xff, 0xfe])],
    });

    expect(audio.subarray(0, 4).toString("utf8")).toBe("OggS");
    expect(audio.includes(Buffer.from("OpusHead"))).toBe(true);
    expect(audio.includes(Buffer.from("OpusTags"))).toBe(true);
    expect(audio[5]).toBe(0x02);

    let lastPageOffset = -1;
    let offset = 0;
    while (offset < audio.length) {
      const pageOffset = audio.indexOf("OggS", offset, "utf8");
      if (pageOffset === -1) break;
      lastPageOffset = pageOffset;
      offset = pageOffset + 4;
    }

    expect(lastPageOffset).toBeGreaterThan(0);
    expect(audio[lastPageOffset + 5]).toBe(0x04);
  });

  it("rejects empty packet lists", () => {
    expect(() => createOggOpusBuffer({ packets: [] })).toThrow(
      "Cannot create Ogg Opus audio without packets",
    );
  });
});

import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { decodeTextFile, decodeUtf8, formatTextPreviewText } from "./text";

describe("decodeUtf8", () => {
  it("strips a BOM, which is an encoding marker and not content", () => {
    const withBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("name,value", "utf8"),
    ]);

    expect(decodeUtf8(withBom).text).toBe("name,value");
    expect(decodeUtf8(withBom).replacedInvalidBytes).toBe(false);
  });

  it("replaces an invalid sequence and says that it did", () => {
    // A lone 0xFF cannot start a UTF-8 sequence. Rejecting the file over it
    // would throw away a Latin-1 export that is otherwise perfectly readable.
    const result = decodeUtf8(Buffer.from([0x41, 0xff, 0x42]));

    expect(result.text).toBe("A�B");
    expect(result.replacedInvalidBytes).toBe(true);
  });
});

describe("decodeTextFile", () => {
  it("keeps only the characters the caller asked for", () => {
    const result = decodeTextFile(Buffer.from("abcdef", "utf8"), {
      maxChars: 3,
    });

    expect(result.text).toBe("abc");
    expect(result.truncated).toBe(true);
  });

  it("does not call a file corrupt for cutting its own buffer", () => {
    // Seven 3-byte characters is 21 bytes; the byte budget for two characters
    // lands inside the sixth. Holding back the incomplete tail is what keeps
    // that from looking like an invalid sequence.
    const result = decodeTextFile(Buffer.from("€".repeat(7), "utf8"), {
      maxChars: 2,
    });

    expect(result.text).toBe("€€");
    expect(result.replacedInvalidBytes).toBe(false);
    expect(result.truncated).toBe(true);
  });

  it("leaves a file that fits alone", () => {
    const json = '{"a":1,"b":[2,3]}';
    const result = decodeTextFile(Buffer.from(json, "utf8"), {
      maxChars: 1000,
    });

    // JSON is not reformatted: the model reads the document the user has.
    expect(result.text).toBe(json);
    expect(result.truncated).toBe(false);
  });
});

describe("formatTextPreviewText", () => {
  it("says what was left out rather than presenting a fragment as whole", () => {
    const text = formatTextPreviewText("notes.md", {
      text: "hello",
      truncated: true,
      replacedInvalidBytes: true,
    });

    expect(text).toContain("notes.md");
    expect(text).toMatch(/truncated/i);
    expect(text).toMatch(/not valid UTF-8/i);
    expect(text).toContain("hello");
  });

  it("stays quiet when there is nothing to warn about", () => {
    const text = formatTextPreviewText("notes.md", {
      text: "hello",
      truncated: false,
      replacedInvalidBytes: false,
    });

    expect(text).not.toMatch(/truncated/i);
    expect(text).toContain("hello");
  });
});

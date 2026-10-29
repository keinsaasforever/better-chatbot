import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { collectSandboxAssets } from "./sandbox-assets";

const msg = (parts: unknown[]): UIMessage =>
  ({ id: crypto.randomUUID(), role: "user", parts }) as UIMessage;

const PHOTO = "https://sb.co/storage/v1/object/public/attachments/u/1-wall.png";
const STREET =
  "https://sb.co/storage/v1/object/public/attachments/u/2-street.png";

describe("collectSandboxAssets", () => {
  it("finds a file uploaded in an EARLIER turn", () => {
    // The reported bug: upload an image, then ask for a page a turn later. The
    // old code read only the current request's attachments, so the model got
    // nothing and asked the user to paste a URL.
    const assets = collectSandboxAssets([
      msg([{ type: "file", url: PHOTO, filename: "wall.png" }]),
      msg([{ type: "text", text: "now build me a landing page" }]),
    ]);

    expect(assets).toEqual([
      { url: PHOTO, filename: "wall.png", mediaType: undefined },
    ]);
  });

  it("reads the url from a `data` URL object as well as `url`", () => {
    // Parts built for the model carry `data` holding a URL; UI parts carry
    // `url`. Both end up persisted in a thread.
    const assets = collectSandboxAssets([
      msg([{ type: "file", data: new URL(STREET), mediaType: "image/png" }]),
    ]);

    expect(assets[0]?.url).toBe(STREET);
    expect(assets[0]?.mediaType).toBe("image/png");
  });

  it("dedupes a url repeated across turns, newest metadata winning", () => {
    const assets = collectSandboxAssets([
      msg([{ type: "file", url: PHOTO, filename: "old.png" }]),
      msg([{ type: "file", url: PHOTO, filename: "new.png" }]),
    ]);

    expect(assets).toHaveLength(1);
    expect(assets[0]?.filename).toBe("new.png");
  });

  it("returns newest first", () => {
    const assets = collectSandboxAssets([
      msg([{ type: "file", url: PHOTO }]),
      msg([{ type: "file", url: STREET }]),
    ]);

    expect(assets.map((a) => a.url)).toEqual([STREET, PHOTO]);
  });

  it("skips base64 data URIs — a sandbox cannot use them", () => {
    const assets = collectSandboxAssets([
      msg([{ type: "file", url: "data:image/png;base64,iVBORw0KGgo=" }]),
    ]);

    expect(assets).toEqual([]);
  });

  it("ignores non-file parts and empty threads", () => {
    expect(collectSandboxAssets([])).toEqual([]);
    expect(collectSandboxAssets([msg([{ type: "text", text: "hi" }])])).toEqual(
      [],
    );
  });

  it("caps a long thread so the prompt cannot balloon", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      msg([{ type: "file", url: `https://sb.co/f/${i}.png` }]),
    );

    expect(collectSandboxAssets(many)).toHaveLength(20);
  });
});

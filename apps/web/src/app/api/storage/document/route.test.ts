import { Buffer } from "node:buffer";
import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {
    download: vi.fn(),
    exists: vi.fn(),
    getSignedUrl: vi.fn(),
  },
  renderDocxHtml: vi.fn(),
  parsePptxPreview: vi.fn(),
}));

vi.mock("auth/route-guard", () => ({
  withAuth:
    (
      handler: (
        request: Request,
        session: { user: { id: string } },
      ) => Promise<Response>,
    ) =>
    (request: Request) =>
      handler(request, { user: { id: "user_123" } }),
}));

vi.mock("lib/file-storage", () => ({
  serverFileStorage: mocks.storage,
}));

vi.mock("lib/file-ingest/docx-html", () => ({
  renderDocxHtml: mocks.renderDocxHtml,
}));

vi.mock("lib/file-ingest/pptx", () => ({
  parsePptxPreview: mocks.parsePptxPreview,
}));

vi.mock("lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { FileNotFoundError } from "lib/errors";
import {
  MAX_DOCUMENT_HTML_BYTES,
  MAX_PREVIEW_BYTES,
} from "lib/file-ingest/preview-limits";
import type { NextRequest } from "next/server";
import { GET } from "./route";

const { storage, renderDocxHtml, parsePptxPreview } = mocks;

const DOCX = "user_123/0f3e2f10-1111-2222-3333-444455556666-contract.docx";
const PPTX = "user_123/0f3e2f10-1111-2222-3333-444455556666-deck.pptx";
const TXT = "user_123/0f3e2f10-1111-2222-3333-444455556666-notes.md";

afterEach(() => {
  delete process.env.PREVIEW_DISABLED_KINDS;
  vi.clearAllMocks();
});

function request(key?: string) {
  const url = new URL("http://localhost/api/storage/document");
  if (key !== undefined) url.searchParams.set("key", key);
  return new Request(url) as unknown as NextRequest;
}

describe("GET /api/storage/document", () => {
  test("renders a .docx as HTML for the owner", async () => {
    storage.download.mockResolvedValue(Buffer.from("docx-bytes"));
    renderDocxHtml.mockResolvedValue("<p>Kündigungsfrist</p>");

    const res = await GET(request(DOCX));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: "document",
      html: "<p>Kündigungsfrist</p>",
      truncated: false,
    });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    // One storage round trip: `exists` lists the user's whole directory.
    expect(storage.exists).not.toHaveBeenCalled();
  });

  test("returns slides for a .pptx", async () => {
    storage.download.mockResolvedValue(Buffer.from("pptx-bytes"));
    parsePptxPreview.mockResolvedValue({
      slides: [{ index: 1, title: "Q1", text: "Revenue up", hidden: false }],
      totalSlides: 1,
      skipped: 0,
      truncated: false,
      partial: true,
    });

    const res = await GET(request(PPTX));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.kind).toBe("slides");
    expect(body.slides[0].title).toBe("Q1");
  });

  test("returns decoded text for a .md, with the decode outcome", async () => {
    storage.download.mockResolvedValue(Buffer.from("# Title\n"));

    const res = await GET(request(TXT));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      kind: "text",
      text: "# Title\n",
      truncated: false,
      replacedInvalidBytes: false,
    });
  });

  test("rejects a missing or traversal key without touching storage", async () => {
    expect((await GET(request())).status).toBe(400);
    expect((await GET(request("user_123/../other/file.docx"))).status).toBe(
      400,
    );
    expect(storage.download).not.toHaveBeenCalled();
  });

  test("refuses a type it has no renderer for, before downloading it", async () => {
    const res = await GET(request("user_123/uuid-notes.doc"));

    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("unsupported");
    expect(storage.download).not.toHaveBeenCalled();
  });

  test("forbids a key owned by another user", async () => {
    const res = await GET(request("user_999/uuid-contract.docx"));

    expect(res.status).toBe(403);
    expect(storage.download).not.toHaveBeenCalled();
  });

  test("can be switched off per kind at request time", async () => {
    process.env.PREVIEW_DISABLED_KINDS = "slides";

    const off = await GET(request(PPTX));
    expect(off.status).toBe(503);
    expect((await off.json()).reason).toBe("disabled");
    expect(storage.download).not.toHaveBeenCalled();

    // Only the named kind: the switch is not an all-or-nothing kill.
    storage.download.mockResolvedValue(Buffer.from("docx-bytes"));
    renderDocxHtml.mockResolvedValue("<p>ok</p>");
    expect((await GET(request(DOCX))).status).toBe(200);
  });

  test("refuses a file past the size cap without parsing it", async () => {
    storage.download.mockResolvedValue(
      Buffer.alloc(MAX_PREVIEW_BYTES.document + 1),
    );

    const res = await GET(request(DOCX));

    expect(res.status).toBe(413);
    expect((await res.json()).reason).toBe("too_large");
    expect(renderDocxHtml).not.toHaveBeenCalled();
  });

  test("offers the download rather than half a document", async () => {
    storage.download.mockResolvedValue(Buffer.from("docx-bytes"));
    renderDocxHtml.mockResolvedValue("x".repeat(MAX_DOCUMENT_HTML_BYTES + 1));

    const res = await GET(request(DOCX));

    // A contract cut in half is worse than one the reader knows to open: the
    // reader cannot tell a truncated document from a short one.
    expect(res.status).toBe(413);
    expect((await res.json()).reason).toBe("too_large");
  });

  test("maps a missing object to 404", async () => {
    storage.download.mockRejectedValue(new FileNotFoundError(DOCX));

    const res = await GET(request(DOCX));

    expect(res.status).toBe(404);
    expect((await res.json()).reason).toBe("not_found");
  });

  test("answers a generic 500 when the file cannot be parsed", async () => {
    storage.download.mockResolvedValue(Buffer.from("docx-bytes"));
    renderDocxHtml.mockRejectedValue(new Error("zip end of central dir"));

    const res = await GET(request(DOCX));

    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.reason).toBe("unreadable");
    // The cause is logged, never returned.
    expect(JSON.stringify(body)).not.toContain("central dir");
  });
});

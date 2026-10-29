import { afterEach, describe, expect, test, vi } from "vitest";

// One object, mutated per test: the route reads `getSignedUrl` off it at call
// time, so deleting the method models a driver without signed URLs.
const mocks = vi.hoisted(() => ({
  storage: {
    download: vi.fn(),
    exists: vi.fn(),
    getSignedUrl: vi.fn() as ReturnType<typeof vi.fn> | undefined,
  },
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

vi.mock("lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { FileNotFoundError } from "lib/errors";
import type { NextRequest } from "next/server";
import { GET } from "./route";

const { storage } = mocks;

const KEY_XLS = "user_123/0f3e2f10-1111-2222-3333-444455556666-report.xls";
const KEY_PDF = "user_123/0f3e2f10-1111-2222-3333-444455556666-report.pdf";
const KEY_SVG = "user_123/0f3e2f10-1111-2222-3333-444455556666-x.svg";
const KEY_HTML = "user_123/0f3e2f10-1111-2222-3333-444455556666-x.html";
const SIGNED = "https://sb.co/storage/v1/object/sign/attachments/k?token=t";

afterEach(() => {
  vi.clearAllMocks();
  storage.getSignedUrl = vi.fn();
});

function request(key?: string, disposition?: string) {
  const url = new URL("http://localhost/api/storage/download");
  if (key !== undefined) url.searchParams.set("key", key);
  if (disposition !== undefined)
    url.searchParams.set("disposition", disposition);
  return new Request(url) as unknown as NextRequest;
}

describe("GET /api/storage/download", () => {
  test("redirects the owner to a short-lived signed URL with the clean filename", async () => {
    storage.exists.mockResolvedValue(true);
    storage.getSignedUrl!.mockResolvedValue(SIGNED);

    const res = await GET(request(KEY_XLS));

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(SIGNED);
    // The Location carries a token: never cacheable.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(storage.getSignedUrl).toHaveBeenCalledWith(KEY_XLS, 60, {
      download: "report.xls",
    });
    // The bytes never pass through the function (Vercel's 4.5 MB cap).
    expect(storage.download).not.toHaveBeenCalled();
  });

  test("serves a PDF inline when asked, so an iframe can render it", async () => {
    storage.exists.mockResolvedValue(true);
    storage.getSignedUrl!.mockResolvedValue(SIGNED);

    const res = await GET(request(KEY_PDF, "inline"));

    expect(res.status).toBe(302);
    expect(storage.getSignedUrl).toHaveBeenCalledWith(KEY_PDF, 60, undefined);
  });

  test("refuses to serve scriptable types inline", async () => {
    storage.exists.mockResolvedValue(true);
    storage.getSignedUrl!.mockResolvedValue(SIGNED);

    // SVG and HTML execute in an origin — inline would be stored XSS.
    await GET(request(KEY_SVG, "inline"));
    expect(storage.getSignedUrl).toHaveBeenLastCalledWith(KEY_SVG, 60, {
      download: "x.svg",
    });

    await GET(request(KEY_HTML, "inline"));
    expect(storage.getSignedUrl).toHaveBeenLastCalledWith(KEY_HTML, 60, {
      download: "x.html",
    });
  });

  test("rejects a missing or traversal key", async () => {
    expect((await GET(request())).status).toBe(400);
    expect((await GET(request("user_123/../other/file"))).status).toBe(400);
  });

  test("forbids keys owned by another user", async () => {
    const res = await GET(request("user_999/uuid-file.pdf"));
    expect(res.status).toBe(403);
    expect(storage.exists).not.toHaveBeenCalled();
    expect(storage.getSignedUrl).not.toHaveBeenCalled();
  });

  test("returns 404 for a missing object without signing anything", async () => {
    storage.exists.mockResolvedValue(false);

    const res = await GET(request(KEY_XLS));

    expect(res.status).toBe(404);
    expect(storage.getSignedUrl).not.toHaveBeenCalled();
  });

  test("answers a generic 500 when the URL cannot be signed", async () => {
    storage.exists.mockResolvedValue(true);
    storage.getSignedUrl!.mockResolvedValue(null);

    const res = await GET(request(KEY_XLS));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Download failed" });
  });

  describe("driver without signed URLs (streaming fallback)", () => {
    test("streams the file with attachment headers for the owner", async () => {
      storage.getSignedUrl = undefined;
      storage.download.mockResolvedValue(Buffer.from("XLS"));

      const res = await GET(request(KEY_XLS));

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/vnd.ms-excel");
      expect(res.headers.get("Content-Disposition")).toBe(
        'attachment; filename="report.xls"',
      );
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(await res.text()).toBe("XLS");
    });

    test("serves a PDF inline when asked", async () => {
      storage.getSignedUrl = undefined;
      storage.download.mockResolvedValue(Buffer.from("%PDF-1.7"));

      const res = await GET(request(KEY_PDF, "inline"));

      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(res.headers.get("Content-Disposition")).toBe(
        'inline; filename="report.pdf"',
      );
    });

    test("refuses to serve scriptable types inline", async () => {
      storage.getSignedUrl = undefined;
      storage.download.mockResolvedValue(Buffer.from("<svg onload=alert(1)>"));

      const svg = await GET(request(KEY_SVG, "inline"));
      expect(svg.headers.get("Content-Disposition")).toBe(
        'attachment; filename="x.svg"',
      );

      const html = await GET(request(KEY_HTML, "inline"));
      expect(html.headers.get("Content-Disposition")).toBe(
        'attachment; filename="x.html"',
      );
    });

    test("maps a missing object to 404 and anything else to a generic 500", async () => {
      storage.getSignedUrl = undefined;

      storage.download.mockRejectedValueOnce(new FileNotFoundError("k"));
      expect((await GET(request("user_123/uuid-a.pdf"))).status).toBe(404);

      storage.download.mockRejectedValueOnce(new Error("supabase exploded"));
      const res = await GET(request("user_123/uuid-b.pdf"));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Download failed" });
    });
  });
});

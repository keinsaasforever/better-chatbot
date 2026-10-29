import { Buffer } from "node:buffer";
import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {
    download: vi.fn(),
    exists: vi.fn(),
    getSignedUrl: vi.fn(),
  },
  parseXlsxPreview: vi.fn(),
  parseCsvPreview: vi.fn(),
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

vi.mock("lib/file-ingest/xlsx", () => ({
  parseXlsxPreview: mocks.parseXlsxPreview,
  PREVIEW_MAX_ROWS: 100,
  PREVIEW_MAX_COLS: 40,
}));

vi.mock("lib/file-ingest/csv", () => ({
  parseCsvPreview: mocks.parseCsvPreview,
}));

vi.mock("lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { FileNotFoundError } from "lib/errors";
import { MAX_SHEET_PREVIEW_BYTES } from "lib/file-ingest/xlsx-preview-limits";
import type { NextRequest } from "next/server";
import { GET } from "./route";

const { storage, parseXlsxPreview, parseCsvPreview } = mocks;

const KEY = "user_123/0f3e2f10-1111-2222-3333-444455556666-report.xlsx";
const PREVIEW = {
  sheets: [
    {
      name: "Positionen",
      header: ["Artikel", "Menge"],
      rows: [["Beratung", "3"]],
      totalRows: 2,
      totalColumns: 2,
      truncated: false,
    },
  ],
  totalSheets: 1,
};

afterEach(() => vi.clearAllMocks());

function request(key?: string) {
  const url = new URL("http://localhost/api/storage/sheet");
  if (key !== undefined) url.searchParams.set("key", key);
  return new Request(url) as unknown as NextRequest;
}

describe("GET /api/storage/sheet", () => {
  test("returns the parsed workbook for the owner", async () => {
    storage.download.mockResolvedValue(Buffer.from("xlsx-bytes"));
    parseXlsxPreview.mockResolvedValue(PREVIEW);

    const res = await GET(request(KEY));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PREVIEW);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(storage.download).toHaveBeenCalledWith(KEY);
    // One storage round trip: these both list the user's whole directory.
    expect(storage.exists).not.toHaveBeenCalled();
    expect(storage.getSignedUrl).not.toHaveBeenCalled();
  });

  test("rejects a missing or traversal key without touching storage", async () => {
    expect((await GET(request())).status).toBe(400);
    expect((await GET(request("user_123/../other/file.xlsx"))).status).toBe(
      400,
    );
    expect(storage.download).not.toHaveBeenCalled();
  });

  test("refuses a file exceljs cannot open, before downloading it", async () => {
    const res = await GET(request("user_123/uuid-book.xls"));

    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("unsupported");
    expect(storage.download).not.toHaveBeenCalled();
  });

  test("serves a CSV as a one-sheet workbook", async () => {
    storage.download.mockResolvedValue(Buffer.from("a,b\n1,2\n"));
    parseCsvPreview.mockReturnValue({
      header: ["a", "b"],
      rows: [["1", "2"]],
      columns: 2,
      totalRows: 2,
      markdownTable: "",
      truncated: false,
      replacedInvalidBytes: false,
    });

    const res = await GET(request("user_123/uuid-data.csv"));

    expect(res.status).toBe(200);
    // The same shape a workbook comes back as, so the panel needs no branch.
    expect(await res.json()).toEqual({
      sheets: [
        {
          name: "",
          header: ["a", "b"],
          rows: [["1", "2"]],
          totalRows: 2,
          totalColumns: 2,
          truncated: false,
        },
      ],
      totalSheets: 1,
    });
    expect(parseXlsxPreview).not.toHaveBeenCalled();
  });

  test("still forbids another user's CSV", async () => {
    const res = await GET(request("user_999/uuid-data.csv"));

    expect(res.status).toBe(403);
    expect(storage.download).not.toHaveBeenCalled();
  });

  test("forbids a key owned by another user", async () => {
    const res = await GET(request("user_999/uuid-report.xlsx"));

    expect(res.status).toBe(403);
    expect(storage.download).not.toHaveBeenCalled();
  });

  test("refuses a workbook past the size cap without parsing it", async () => {
    storage.download.mockResolvedValue(
      Buffer.alloc(MAX_SHEET_PREVIEW_BYTES + 1),
    );

    const res = await GET(request(KEY));

    expect(res.status).toBe(413);
    expect((await res.json()).reason).toBe("too_large");
    expect(parseXlsxPreview).not.toHaveBeenCalled();
  });

  test("maps a missing object to 404", async () => {
    storage.download.mockRejectedValue(new FileNotFoundError(KEY));

    const res = await GET(request(KEY));

    expect(res.status).toBe(404);
    expect((await res.json()).reason).toBe("not_found");
  });

  test("answers a generic 500 when the workbook cannot be parsed", async () => {
    storage.download.mockResolvedValue(Buffer.from("xlsx-bytes"));
    parseXlsxPreview.mockRejectedValue(new Error("zip end of central dir"));

    const res = await GET(request(KEY));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.reason).toBe("unreadable");
    // The cause is logged, never returned.
    expect(JSON.stringify(body)).not.toContain("central dir");
  });
});

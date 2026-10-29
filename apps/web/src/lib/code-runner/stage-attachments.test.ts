import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkAccessMock, selectMessagesMock, downloadMock } = vi.hoisted(
  () => ({
    checkAccessMock: vi.fn(),
    selectMessagesMock: vi.fn(),
    downloadMock: vi.fn(),
  }),
);

vi.mock("lib/db/repository", () => ({
  chatRepository: {
    checkAccess: checkAccessMock,
    selectMessagesByThreadId: selectMessagesMock,
  },
}));
vi.mock("lib/file-storage", () => ({
  serverFileStorage: { download: downloadMock },
}));
vi.mock("lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  MAX_STAGED_FILE_BYTES,
  collectThreadAttachments,
  dedupeStagedName,
  isUserOwnedStorageKey,
  sanitizeStagedFilename,
  storageKeyFromUrl,
} from "./stage-attachments";

afterEach(() => vi.clearAllMocks());

const filePart = (url: string, filename?: string) => ({
  type: "file" as const,
  url,
  filename,
});

describe("storageKeyFromUrl", () => {
  test("extracts the key from a public attachments URL", () => {
    expect(
      storageKeyFromUrl(
        "https://x.supabase.co/storage/v1/object/public/attachments/u1/data.csv",
      ),
    ).toBe("u1/data.csv");
  });

  test("extracts the key from a signed URL and drops the token query", () => {
    expect(
      storageKeyFromUrl(
        "https://x.supabase.co/storage/v1/object/sign/attachments/u1/data.csv?token=abc.def",
      ),
    ).toBe("u1/data.csv");
  });

  test("url-decodes the key", () => {
    expect(
      storageKeyFromUrl(
        "https://x.supabase.co/storage/v1/object/public/attachments/u1/my%20file.csv",
      ),
    ).toBe("u1/my file.csv");
  });

  test("returns null for data URIs and non-storage URLs", () => {
    expect(storageKeyFromUrl("data:text/csv;base64,AAAA")).toBeNull();
    expect(storageKeyFromUrl("https://evil.example.com/steal")).toBeNull();
    expect(storageKeyFromUrl("not a url")).toBeNull();
  });

  test("rejects URLs for a different storage bucket", () => {
    expect(
      storageKeyFromUrl(
        "https://x.supabase.co/storage/v1/object/public/avatars/u1/data.csv",
      ),
    ).toBeNull();
  });
});

describe("isUserOwnedStorageKey", () => {
  test("accepts only keys below the authenticated user's prefix", () => {
    expect(isUserOwnedStorageKey("u1/data.csv", "u1")).toBe(true);
    expect(isUserOwnedStorageKey("u2/data.csv", "u1")).toBe(false);
    expect(isUserOwnedStorageKey("u1/../u2/data.csv", "u1")).toBe(false);
  });
});

describe("sanitizeStagedFilename", () => {
  test("preserves a normal name with dots and dashes", () => {
    expect(
      sanitizeStagedFilename("account-statement_21-Oct-2025_04-Aug-2026.csv"),
    ).toBe("account-statement_21-Oct-2025_04-Aug-2026.csv");
  });

  test("strips directory traversal to a basename", () => {
    expect(sanitizeStagedFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeStagedFilename("/home/user/x/report.pdf")).toBe(
      "report.pdf",
    );
  });

  test("preserves valid visible characters and never returns an invalid name", () => {
    expect(sanitizeStagedFilename("Q2 revenue € (final).csv")).toBe(
      "Q2 revenue € (final).csv",
    );
    expect(sanitizeStagedFilename(".env")).toBe(".env");
    expect(sanitizeStagedFilename("bad\0name\n.csv")).toBe("bad_name_.csv");
    expect(sanitizeStagedFilename("")).toBe("attachment");
    expect(sanitizeStagedFilename(".")).toBe("attachment");
    expect(sanitizeStagedFilename("..")).toBe("attachment");
  });
});

describe("dedupeStagedName", () => {
  test("suffixes collisions before the extension, deterministically", () => {
    const seen = new Set<string>();
    expect(dedupeStagedName("data.csv", seen)).toBe("data.csv");
    expect(dedupeStagedName("data.csv", seen)).toBe("data-1.csv");
    expect(dedupeStagedName("data.csv", seen)).toBe("data-2.csv");
  });

  test("handles names without an extension", () => {
    const seen = new Set<string>();
    expect(dedupeStagedName("README", seen)).toBe("README");
    expect(dedupeStagedName("README", seen)).toBe("README-1");
  });
});

describe("collectThreadAttachments", () => {
  test("returns [] and stages nothing when the user lacks access", async () => {
    checkAccessMock.mockResolvedValue(false);
    const files = await collectThreadAttachments("t1", "u1");
    expect(files).toEqual([]);
    expect(selectMessagesMock).not.toHaveBeenCalled();
    expect(downloadMock).not.toHaveBeenCalled();
  });

  test("downloads file parts and stages them under sanitized names", async () => {
    checkAccessMock.mockResolvedValue(true);
    selectMessagesMock.mockResolvedValue([
      {
        parts: [
          { type: "text", text: "hi" },
          filePart(
            "https://x.supabase.co/storage/v1/object/public/attachments/u1/account.csv",
            "account-statement.csv",
          ),
        ],
      },
    ]);
    downloadMock.mockResolvedValue(Buffer.from("a,b\n1,2\n"));

    const files = await collectThreadAttachments("t1", "u1");

    expect(downloadMock).toHaveBeenCalledWith("u1/account.csv");
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe("account-statement.csv");
    expect(files[0].bytes.toString()).toBe("a,b\n1,2\n");
  });

  test("stages a CSV source-url under the filename shown to the model", async () => {
    const url =
      "https://x.supabase.co/storage/v1/object/public/attachments/u1/upload.csv";
    const filename = "account-statement_21-Oct-2025_04-Aug-2026.csv";
    checkAccessMock.mockResolvedValue(true);
    selectMessagesMock.mockResolvedValue([
      {
        parts: [
          {
            type: "source-url",
            sourceId: url,
            url,
            mediaType: "text/csv",
            title: filename,
          },
        ],
      },
    ]);
    downloadMock.mockResolvedValue(
      Buffer.from("date,revenue\n2026-08-01,42\n"),
    );

    const files = await collectThreadAttachments("t1", "u1");

    expect(downloadMock).toHaveBeenCalledWith("u1/upload.csv");
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe(filename);
    expect(files[0].bytes.toString()).toBe("date,revenue\n2026-08-01,42\n");
  });

  test("stages persisted file parts whose storage URL is in data", async () => {
    const url =
      "https://x.supabase.co/storage/v1/object/public/attachments/u1/data.csv";
    checkAccessMock.mockResolvedValue(true);
    selectMessagesMock.mockResolvedValue([
      {
        parts: [
          {
            type: "file",
            data: url,
            mediaType: "text/csv",
            filename: "data.csv",
          },
        ],
      },
    ]);
    downloadMock.mockResolvedValue(Buffer.from("a,b\n1,2\n"));

    const files = await collectThreadAttachments("t1", "u1");

    expect(downloadMock).toHaveBeenCalledWith("u1/data.csv");
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe("data.csv");
    expect(files[0].bytes.toString()).toBe("a,b\n1,2\n");
  });

  test("deduplicates the same storage key referenced twice", async () => {
    checkAccessMock.mockResolvedValue(true);
    const url =
      "https://x.supabase.co/storage/v1/object/public/attachments/u1/account.csv";
    selectMessagesMock.mockResolvedValue([
      { parts: [filePart(url, "account.csv")] },
      { parts: [filePart(url, "account.csv")] },
    ]);
    downloadMock.mockResolvedValue(Buffer.from("x"));

    const files = await collectThreadAttachments("t1", "u1");

    expect(files).toHaveLength(1);
    expect(downloadMock).toHaveBeenCalledTimes(1);
  });

  test("keeps the newest duplicate filename unsuffixed", async () => {
    checkAccessMock.mockResolvedValue(true);
    const oldUrl =
      "https://x.supabase.co/storage/v1/object/public/attachments/u1/old.csv";
    const newUrl =
      "https://x.supabase.co/storage/v1/object/public/attachments/u1/new.csv";
    selectMessagesMock.mockResolvedValue([
      { parts: [filePart(oldUrl, "data.csv")] },
      { parts: [filePart(newUrl, "data.csv")] },
    ]);
    downloadMock.mockImplementation(async (key: string) =>
      Buffer.from(key.includes("new.csv") ? "new" : "old"),
    );

    const files = await collectThreadAttachments("t1", "u1");

    expect(files.map(({ filename }) => filename)).toEqual([
      "data.csv",
      "data-1.csv",
    ]);
    expect(files.map(({ bytes }) => bytes.toString())).toEqual(["new", "old"]);
  });

  test("does not download another user's storage key", async () => {
    checkAccessMock.mockResolvedValue(true);
    selectMessagesMock.mockResolvedValue([
      {
        parts: [
          filePart(
            "https://x.supabase.co/storage/v1/object/public/attachments/u2/private.csv",
            "private.csv",
          ),
        ],
      },
    ]);

    const files = await collectThreadAttachments("t1", "u1");

    expect(files).toEqual([]);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  test("skips oversize files without failing the batch", async () => {
    checkAccessMock.mockResolvedValue(true);
    selectMessagesMock.mockResolvedValue([
      {
        parts: [
          filePart(
            "https://x.supabase.co/storage/v1/object/public/attachments/u1/big.bin",
            "big.bin",
          ),
          filePart(
            "https://x.supabase.co/storage/v1/object/public/attachments/u1/ok.csv",
            "ok.csv",
          ),
        ],
      },
    ]);
    downloadMock.mockImplementation(async (key: string) =>
      key.endsWith("big.bin")
        ? Buffer.alloc(MAX_STAGED_FILE_BYTES + 1)
        : Buffer.from("ok"),
    );

    const files = await collectThreadAttachments("t1", "u1");

    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe("ok.csv");
  });

  test("skips a file whose download throws, keeping the rest", async () => {
    checkAccessMock.mockResolvedValue(true);
    selectMessagesMock.mockResolvedValue([
      {
        parts: [
          filePart(
            "https://x.supabase.co/storage/v1/object/public/attachments/u1/gone.csv",
            "gone.csv",
          ),
          filePart(
            "https://x.supabase.co/storage/v1/object/public/attachments/u1/ok.csv",
            "ok.csv",
          ),
        ],
      },
    ]);
    downloadMock.mockImplementation(async (key: string) => {
      if (key.endsWith("gone.csv")) throw new Error("not found");
      return Buffer.from("ok");
    });

    const files = await collectThreadAttachments("t1", "u1");

    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe("ok.csv");
  });

  test("ignores non-file parts and external URLs", async () => {
    checkAccessMock.mockResolvedValue(true);
    selectMessagesMock.mockResolvedValue([
      {
        parts: [
          { type: "text", text: "hello" },
          {
            type: "file",
            url: "https://evil.example.com/x.csv",
            filename: "x",
          },
        ],
      },
    ]);

    const files = await collectThreadAttachments("t1", "u1");

    expect(files).toEqual([]);
    expect(downloadMock).not.toHaveBeenCalled();
  });
});

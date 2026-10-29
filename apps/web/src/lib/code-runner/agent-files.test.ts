import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { downloadMock } = vi.hoisted(() => ({ downloadMock: vi.fn() }));

vi.mock("lib/db/repository", () => ({
  chatRepository: {
    checkAccess: vi.fn(),
    selectMessagesByThreadId: vi.fn(),
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
  collectAgentFiles,
  mergeStagedFiles,
} from "./stage-attachments";

afterEach(() => vi.clearAllMocks());

const binding = (storageKey: string, filename: string) => ({
  storageKey,
  filename,
});

describe("collectAgentFiles", () => {
  test("downloads each bound file under its documented name", async () => {
    downloadMock.mockResolvedValue(Buffer.from("<html></html>"));

    const files = await collectAgentFiles([
      binding("user-1/template.html", "template.html"),
      binding("user-1/render.py", "render.py"),
    ]);

    expect(files.map((file) => file.filename)).toEqual([
      "template.html",
      "render.py",
    ]);
    expect(downloadMock).toHaveBeenCalledTimes(2);
  });

  test("returns nothing when the agent has no files", async () => {
    expect(await collectAgentFiles(undefined)).toEqual([]);
    expect(await collectAgentFiles([])).toEqual([]);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  test("skips a file that has been deleted rather than failing the run", async () => {
    downloadMock
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce(Buffer.from("print('hi')"));

    const files = await collectAgentFiles([
      binding("user-1/gone.html", "template.html"),
      binding("user-1/render.py", "render.py"),
    ]);

    expect(files.map((file) => file.filename)).toEqual(["render.py"]);
  });

  test("skips a file over the per-file cap", async () => {
    downloadMock.mockResolvedValue(Buffer.alloc(MAX_STAGED_FILE_BYTES + 1, 0));

    expect(
      await collectAgentFiles([binding("user-1/big.pdf", "big.pdf")]),
    ).toEqual([]);
  });

  test("suffixes a duplicate name so one file cannot shadow another", async () => {
    downloadMock.mockResolvedValue(Buffer.from("x"));

    const files = await collectAgentFiles([
      binding("user-1/a/template.html", "template.html"),
      binding("user-1/b/template.html", "template.html"),
    ]);

    expect(files.map((file) => file.filename)).toEqual([
      "template.html",
      "template-1.html",
    ]);
  });
});

describe("mergeStagedFiles", () => {
  test("the agent keeps the exact name its instructions document", () => {
    const merged = mergeStagedFiles(
      [{ filename: "template.html", bytes: Buffer.from("agent") }],
      [{ filename: "template.html", bytes: Buffer.from("upload") }],
    );

    expect(merged.map((file) => file.filename)).toEqual([
      "template.html",
      "template-1.html",
    ]);
    expect(merged[0].bytes.toString()).toBe("agent");
  });

  test("leaves non-colliding names alone", () => {
    const merged = mergeStagedFiles(
      [{ filename: "render.py", bytes: Buffer.from("a") }],
      [{ filename: "data.csv", bytes: Buffer.from("b") }],
    );

    expect(merged.map((file) => file.filename)).toEqual([
      "render.py",
      "data.csv",
    ]);
  });
});

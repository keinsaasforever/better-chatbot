import { describe, expect, test, vi } from "vitest";

vi.mock("lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { Sandbox } from "@e2b/code-interpreter";
import {
  ARTIFACT_LIST_DEPTH,
  type ListedFile,
  MAX_ARTIFACT_FILE_BYTES,
  MAX_ARTIFACT_TOTAL_BYTES,
  collectGeneratedFiles,
  findGeneratedFiles,
  mimeTypeForFile,
  snapshotListing,
  snapshotWorkdir,
} from "./artifact-files";

function file(name: string, size: number, type = "file"): ListedFile {
  return { name, path: `/home/user/${name}`, type, size };
}

/** An entry one directory down, as the SDK lists it with depth 2. */
function nested(dir: string, name: string, size: number): ListedFile {
  return { name, path: `/home/user/${dir}/${name}`, type: "file", size };
}

describe("mimeTypeForFile", () => {
  test("maps known extensions", () => {
    expect(mimeTypeForFile("report.pdf")).toBe("application/pdf");
    expect(mimeTypeForFile("data.CSV")).toBe("text/csv");
    expect(mimeTypeForFile("sheet.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  test("falls back to octet-stream", () => {
    expect(mimeTypeForFile("weird.xyz")).toBe("application/octet-stream");
    expect(mimeTypeForFile("noextension")).toBe("application/octet-stream");
  });
});

describe("snapshotListing / findGeneratedFiles", () => {
  test("detects new files only", () => {
    const before = snapshotListing([file("existing.txt", 10)]);
    const after = [file("existing.txt", 10), file("report.pdf", 1000)];
    expect(findGeneratedFiles(before, after).map((f) => f.name)).toEqual([
      "report.pdf",
    ]);
  });

  test("detects size-changed files", () => {
    const before = snapshotListing([file("data.csv", 10)]);
    const after = [file("data.csv", 999)];
    expect(findGeneratedFiles(before, after)).toHaveLength(1);
  });

  test("ignores directories, hidden and empty files", () => {
    const before = new Map<string, number>();
    const after = [
      file("subdir", 4096, "dir"),
      file(".hidden", 100),
      file("empty.txt", 0),
      file("keep.pdf", 5),
    ];
    expect(findGeneratedFiles(before, after).map((f) => f.name)).toEqual([
      "keep.pdf",
    ]);
  });

  test("keeps a file one directory down but not tooling state", () => {
    const after = [
      nested("out", "report.xlsx", 50),
      nested(".cache", "pip.lock", 50),
      nested("__pycache__", "mod.pyc", 50),
      nested("node_modules", "x.js", 50),
    ];
    expect(findGeneratedFiles(new Map(), after).map((f) => f.path)).toEqual([
      "/home/user/out/report.xlsx",
    ]);
  });
});

describe("collectGeneratedFiles", () => {
  function mockSandbox(entries: ListedFile[], content = "PDFDATA") {
    const read = vi.fn().mockResolvedValue(new TextEncoder().encode(content));
    const list = vi.fn().mockResolvedValue(entries);
    return {
      sbx: { files: { list, read } } as unknown as Sandbox,
      read,
      list,
    };
  }

  test("reads new files as byte artifacts, not base64", async () => {
    const { sbx, list } = mockSandbox([file("report.pdf", 7)]);
    const artifacts = await collectGeneratedFiles(sbx, new Map());

    expect(list).toHaveBeenCalledWith("/home/user", {
      depth: ARTIFACT_LIST_DEPTH,
    });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      filename: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 7,
    });
    expect(Buffer.from(artifacts[0].bytes!).toString()).toBe("PDFDATA");
    expect(artifacts[0].contentBase64).toBeUndefined();
  });

  test("reports an oversized file instead of dropping it, and keeps the rest", async () => {
    const { sbx, read } = mockSandbox([
      file("huge.pdf", MAX_ARTIFACT_FILE_BYTES + 1),
      file("small.csv", 7),
    ]);
    const artifacts = await collectGeneratedFiles(sbx, new Map());

    expect(artifacts.map((a) => a.filename)).toEqual(["huge.pdf", "small.csv"]);
    expect(artifacts[0]).toMatchObject({
      sizeBytes: MAX_ARTIFACT_FILE_BYTES + 1,
      error: expect.stringContaining("too large"),
    });
    expect(artifacts[0].bytes).toBeUndefined();
    // Only the small file was read.
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("stops reading once the per-run budget is spent", async () => {
    const half = MAX_ARTIFACT_TOTAL_BYTES / 2;
    const { sbx, read } = mockSandbox([
      file("a.bin", half),
      file("b.bin", half),
      file("c.bin", 1),
    ]);
    // Only `byteLength` matters to the budget; do not allocate 100 MiB here.
    read.mockImplementation((path: string) =>
      Promise.resolve({ byteLength: path.endsWith("c.bin") ? 1 : half }),
    );
    const artifacts = await collectGeneratedFiles(sbx, new Map());

    expect(artifacts.map((a) => a.filename)).toEqual([
      "a.bin",
      "b.bin",
      "c.bin",
    ]);
    expect(artifacts[2].error).toContain("budget");
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("returns empty on listing failure instead of throwing", async () => {
    const sbx = {
      files: { list: vi.fn().mockRejectedValue(new Error("boom")) },
    } as unknown as Sandbox;
    await expect(collectGeneratedFiles(sbx, new Map())).resolves.toEqual([]);
  });
});

describe("snapshotWorkdir", () => {
  function mockListOnly(entries: ListedFile[]) {
    const list = vi.fn().mockResolvedValue(entries);
    return { sbx: { files: { list } } as unknown as Sandbox, list };
  }

  test("lists with the same depth as collection so nested files are not misreported", async () => {
    const { sbx, list } = mockListOnly([nested("out", "seed.csv", 3)]);
    const snapshot = await snapshotWorkdir(sbx);

    expect(list).toHaveBeenCalledWith("/home/user", {
      depth: ARTIFACT_LIST_DEPTH,
    });
    expect(snapshot.get("/home/user/out/seed.csv")).toBe(3);
  });
});

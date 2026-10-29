import { describe, expect, it } from "vitest";
import type { CodeRunnerResult } from "./code-runner.interface";
import { errorToCodeRunnerResult, toCodeToolOutput } from "./tool-output";

const base: CodeRunnerResult = { success: true, logs: [], backend: "e2b" };

describe("toCodeToolOutput", () => {
  it("drops artifact bytes and reports their size instead", () => {
    const contentBase64 = "A".repeat(400);
    const output = toCodeToolOutput({
      ...base,
      artifacts: [
        { filename: "report.pdf", mimeType: "application/pdf", contentBase64 },
      ],
    });

    expect(output.artifacts).toEqual([
      {
        filename: "report.pdf",
        mimeType: "application/pdf",
        url: undefined,
        sizeBytes: 300,
      },
    ]);
    expect(JSON.stringify(output)).not.toContain(contentBase64);
  });

  it("keeps the durable url so the download survives a refresh", () => {
    const output = toCodeToolOutput({
      ...base,
      artifacts: [{ filename: "data.csv", url: "/api/storage/download?key=k" }],
    });

    expect(output.artifacts).toEqual([
      {
        filename: "data.csv",
        mimeType: undefined,
        url: "/api/storage/download?key=k",
        sizeBytes: undefined,
      },
    ]);
  });

  it("keeps a size measured at collection time once the bytes are gone", () => {
    const output = toCodeToolOutput({
      ...base,
      artifacts: [
        {
          filename: "book.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          url: "/api/storage/download?key=k",
          sizeBytes: 5_000_000,
        },
      ],
    });

    expect(output.artifacts?.[0]).toMatchObject({
      url: "/api/storage/download?key=k",
      sizeBytes: 5_000_000,
    });
  });

  it("keeps the reason a file was not delivered and never its bytes", () => {
    const output = toCodeToolOutput({
      ...base,
      artifacts: [
        {
          filename: "huge.pdf",
          sizeBytes: 99,
          error: "file too large",
          bytes: new Uint8Array(2),
        } as never,
      ],
    });

    expect(output.artifacts).toEqual([
      {
        filename: "huge.pdf",
        mimeType: undefined,
        url: undefined,
        sizeBytes: 99,
        error: "file too large",
      },
    ]);
    expect(JSON.stringify(output)).not.toContain("bytes");
  });

  it("collapses oversized logs to a single notice", () => {
    const logs = Array.from({ length: 200 }, () => ({
      type: "log",
      args: [{ type: "data" as const, value: "x".repeat(100) }],
    }));

    const output = toCodeToolOutput({ ...base, logs });

    expect(output.logs).toHaveLength(1);
    expect(JSON.stringify(output.logs)).toContain("exceeded storage limit");
  });

  it("keeps small logs verbatim", () => {
    const logs = [
      { type: "log", args: [{ type: "data" as const, value: "hi" }] },
    ];
    expect(toCodeToolOutput({ ...base, logs }).logs).toEqual(logs);
  });

  it("tells the model the files are cards it must name, never link", () => {
    const guide = toCodeToolOutput(base).guide;
    expect(guide).toContain("file cards");
    expect(guide).toContain("Never write a link");
  });

  it("guides the model on both success and failure", () => {
    expect(toCodeToolOutput(base).guide).toContain("Execution finished");
    expect(
      toCodeToolOutput({ ...base, success: false, error: "SyntaxError: bad" })
        .guide,
    ).toContain("Error explanations");
  });
});

describe("errorToCodeRunnerResult", () => {
  it("turns a throw into a failure result the model can read", () => {
    const result = errorToCodeRunnerResult(new Error("network down"));

    expect(result.success).toBe(false);
    expect(result.error).toBe("network down");
    expect(result.logs[0]?.type).toBe("error");
  });

  it("handles non-Error throws", () => {
    expect(errorToCodeRunnerResult("boom").error).toBe("boom");
  });
});

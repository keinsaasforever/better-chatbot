import { describe, expect, test, vi } from "vitest";
import type { Sandbox } from "@e2b/code-interpreter";
import {
  collectSandboxFilePaths,
  sanitizeNextJsRouteConflicts,
} from "./nextjs-route-sanitizer";

function createMockSandbox() {
  const run = vi
    .fn()
    .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  return {
    commands: { run },
  } as unknown as Sandbox & {
    commands: { run: ReturnType<typeof vi.fn> };
  };
}

describe("collectSandboxFilePaths", () => {
  test("returns single file path for string code", () => {
    expect(
      collectSandboxFilePaths(
        "pages/index.tsx",
        "export default function Page() {}",
      ),
    ).toEqual(["pages/index.tsx"]);
  });

  test("returns all paths from multi-file code array", () => {
    expect(
      collectSandboxFilePaths("pages/index.tsx", [
        { file_path: "pages/index.tsx", file_content: "a" },
        { file_path: "pages/about.tsx", file_content: "b" },
      ]),
    ).toEqual(["pages/index.tsx", "pages/about.tsx"]);
  });
});

describe("sanitizeNextJsRouteConflicts", () => {
  test("no-op for non-nextjs templates", async () => {
    const sbx = createMockSandbox();
    await sanitizeNextJsRouteConflicts(sbx, "vue-developer", ["app/app.vue"]);
    expect(sbx.commands.run).not.toHaveBeenCalled();
  });

  test("removes pages/index.tsx when writing app router home page", async () => {
    const sbx = createMockSandbox();
    await sanitizeNextJsRouteConflicts(sbx, "nextjs-developer", [
      "app/page.tsx",
    ]);
    expect(sbx.commands.run).toHaveBeenCalledWith(
      "rm -f pages/index.tsx pages/index.js",
    );
  });

  test("removes app/page.tsx when writing pages router home page", async () => {
    const sbx = createMockSandbox();
    await sanitizeNextJsRouteConflicts(sbx, "nextjs-developer", [
      "pages/index.tsx",
    ]);
    expect(sbx.commands.run).toHaveBeenCalledWith(
      "rm -f app/page.tsx app/page.js",
    );
  });

  test("does not remove routes for nested pages routes only", async () => {
    const sbx = createMockSandbox();
    await sanitizeNextJsRouteConflicts(sbx, "nextjs-developer", [
      "pages/about.tsx",
    ]);
    expect(sbx.commands.run).not.toHaveBeenCalled();
  });
});

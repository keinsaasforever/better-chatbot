import type { Sandbox } from "@e2b/code-interpreter";

const PAGES_ROUTER_TEMPLATES = new Set(["nextjs-developer"]);

function isAppRouterHomePage(filePath: string): boolean {
  return filePath === "app/page.tsx" || filePath === "app/page.js";
}

function isPagesRouterHomePage(filePath: string): boolean {
  return filePath === "pages/index.tsx" || filePath === "pages/index.js";
}

export async function sanitizeNextJsRouteConflicts(
  sbx: Sandbox,
  template: string,
  filePaths: string[],
) {
  if (!PAGES_ROUTER_TEMPLATES.has(template)) return;

  const writesAppRouterHome = filePaths.some(isAppRouterHomePage);
  const writesPagesRouterHome = filePaths.some(isPagesRouterHomePage);

  if (writesAppRouterHome) {
    await sbx.commands
      .run("rm -f pages/index.tsx pages/index.js")
      .catch(() => {});
  }
  if (writesPagesRouterHome) {
    await sbx.commands.run("rm -f app/page.tsx app/page.js").catch(() => {});
  }
}

export function collectSandboxFilePaths(
  filePath: string,
  code: string | { file_path: string; file_content: string }[],
): string[] {
  if (Array.isArray(code)) {
    return code.map((file) => file.file_path);
  }
  return [filePath];
}

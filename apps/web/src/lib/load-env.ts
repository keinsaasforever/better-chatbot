import { config } from "dotenv";
import { existsSync } from "fs";
import { dirname, join } from "path";

// After the apps/web move the process cwd is apps/web, but developer .env
// files may still live at the repo root. Load cwd first (wins per key), then
// fall back to the workspace root so both locations keep working. Note that
// Next.js's own env loader (NEXT_PUBLIC_* inlining) only reads apps/web/.env*;
// scripts/initial-env.ts links apps/web/.env to the root .env for that.
const findWorkspaceRoot = (start: string): string | undefined => {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
};

export const load = <T extends Record<string, string> = Record<string, string>>(
  root: string = process.cwd(),
): T => {
  const roots = [root];
  const workspaceRoot = findWorkspaceRoot(root);
  if (workspaceRoot && workspaceRoot !== root) roots.push(workspaceRoot);
  const paths = roots.flatMap((dir) => [
    join(dir, ".env.local"),
    join(dir, `.env.${process.env.NODE_ENV}`),
    join(dir, ".env"),
  ]);
  return paths.reduce<T>((prev, path) => {
    const variables = !existsSync(path) ? {} : (config({ path }).parsed ?? {});
    Object.entries(variables).forEach(([key, value]) => {
      if (!Object.prototype.hasOwnProperty.call(prev, key))
        Object.assign(prev, { [key]: value });
    });
    return prev;
  }, {} as T);
};

load();

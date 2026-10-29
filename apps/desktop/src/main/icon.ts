import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const desktopRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Platform-native icon for BrowserWindow / dock (dev + packaged). */
export function resolveAppIconPath(): string | undefined {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(desktopRoot, "build/icon-win.png"),
          path.join(desktopRoot, "build/icon.png"),
        ]
      : process.platform === "darwin"
        ? [
            path.join(desktopRoot, "build/icon.icns"),
            path.join(desktopRoot, "build/icon.png"),
          ]
        : [path.join(desktopRoot, "build/icon.png")];

  return candidates.find((candidate) => existsSync(candidate));
}

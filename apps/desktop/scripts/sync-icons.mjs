import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const webAppDir = join(desktopRoot, "../web/src/app");
const buildDir = join(desktopRoot, "build");

mkdirSync(buildDir, { recursive: true });

copyFileSync(
  join(webAppDir, "android-chrome-512x512.png"),
  join(buildDir, "icon.png"),
);
// electron-builder needs >=256px; favicon.ico is too small for Windows packaging.
copyFileSync(
  join(webAppDir, "android-chrome-512x512.png"),
  join(buildDir, "icon-win.png"),
);

console.log("Desktop icons synced from apps/web/src/app");

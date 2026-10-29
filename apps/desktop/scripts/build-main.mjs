import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");

const bakedWebUrl =
  process.env.KEINSAAS_WEB_URL?.trim() || "https://app.keinsaas.com";

await esbuild.build({
  entryPoints: [path.join(desktopRoot, "src/main/index.ts")],
  outfile: path.join(desktopRoot, "dist/main/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  define: {
    "process.env.KEINSAAS_WEB_URL": JSON.stringify(bakedWebUrl),
  },
  external: ["electron", "electron-updater"],
  plugins: [
    {
      name: "bundle-workspace-only",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.path.startsWith("@keinsaas/") || args.path === "zod") {
            return null;
          }
          if (
            !args.path.startsWith(".") &&
            !path.isAbsolute(args.path) &&
            !args.path.startsWith("node:")
          ) {
            return { path: args.path, external: true };
          }
          return null;
        });
      },
    },
  ],
  logLevel: "info",
});

console.log("Desktop main process bundled to dist/main/index.js");

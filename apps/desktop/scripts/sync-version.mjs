import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(desktopRoot, "package.json");

const raw =
  process.env.RELEASE_VERSION?.trim() || process.argv[2]?.trim() || "";
if (!raw) {
  console.error("RELEASE_VERSION or argv[2] required (e.g. v1.2.0)");
  process.exit(1);
}

const version = raw.replace(/^v/, "");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`desktop package.json version → ${version}`);

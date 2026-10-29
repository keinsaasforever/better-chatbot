/**
 * Upload desktop release artifacts to DigitalOcean Spaces (S3-compatible)
 * and create stable /latest/* aliases for the marketing download page.
 *
 * Required env:
 *   DO_SPACES_BUCKET, DO_SPACES_ENDPOINT
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (DO Spaces keys)
 * Optional:
 *   DO_SPACES_PREFIX (default: desktop)
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(desktopRoot, "out");

const bucket = process.env.DO_SPACES_BUCKET?.trim();
const endpoint = process.env.DO_SPACES_ENDPOINT?.trim();
const prefix = (process.env.DO_SPACES_PREFIX ?? "desktop").replace(
  /^\/+|\/+$/g,
  "",
);

if (!bucket || !endpoint) {
  console.error("DO_SPACES_BUCKET and DO_SPACES_ENDPOINT are required");
  process.exit(1);
}

const artifactPattern = /\.(dmg|exe|zip|yml|blockmap|AppImage)$/i;

function aws(args) {
  execFileSync("aws", args, {
    stdio: "inherit",
    env: {
      ...process.env,
      AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION ?? "us-east-1",
    },
  });
}

function s3Uri(key) {
  return `s3://${bucket}/${prefix}/${key}`;
}

function uploadFile(localPath, key) {
  console.log(`upload ${localPath} → ${s3Uri(key)}`);
  aws([
    "s3",
    "cp",
    localPath,
    s3Uri(key),
    "--endpoint-url",
    endpoint,
    "--acl",
    "public-read",
    "--content-type",
    guessContentType(key),
  ]);
}

function guessContentType(key) {
  if (key.endsWith(".yml")) return "text/yaml";
  if (key.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (key.endsWith(".exe"))
    return "application/vnd.microsoft.portable-executable";
  if (key.endsWith(".zip")) return "application/zip";
  if (key.endsWith(".blockmap")) return "application/octet-stream";
  return "application/octet-stream";
}

function listOutFiles() {
  try {
    return readdirSync(outDir).filter((name) => artifactPattern.test(name));
  } catch {
    console.error(`Output directory missing: ${outDir}`);
    process.exit(1);
  }
}

const files = listOutFiles();
if (files.length === 0) {
  console.error("No release artifacts found in out/");
  process.exit(1);
}

for (const name of files) {
  uploadFile(join(outDir, name), name);
}

const dmg = files.find((name) => name.endsWith(".dmg"));
if (dmg) {
  uploadFile(join(outDir, dmg), "latest/mac.dmg");
}

const exe = files.find((name) => name.endsWith(".exe"));
if (exe) {
  uploadFile(join(outDir, exe), "latest/win.exe");
}

console.log("Desktop release published to Spaces.");

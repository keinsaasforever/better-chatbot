import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const smokePort = 3456;
const webUrl = `http://127.0.0.1:${smokePort}`;

const server = spawn(process.execPath, ["scripts/smoke-server.mjs"], {
  cwd: desktopRoot,
  env: { ...process.env, SMOKE_PORT: String(smokePort) },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverReady = false;
server.stdout?.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (text.includes("smoke server listening")) serverReady = true;
});
server.stderr?.on("data", (chunk) => process.stderr.write(chunk));

for (let i = 0; i < 50 && !serverReady; i += 1) {
  await delay(100);
}

if (!serverReady) {
  console.error("Smoke server did not start in time");
  server.kill();
  process.exit(1);
}

const electronBin = join(
  desktopRoot,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);

const electron = spawn(electronBin, ["."], {
  cwd: desktopRoot,
  env: {
    ...process.env,
    NODE_ENV: "development",
    KEINSAAS_WEB_URL: webUrl,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let bridgeOk = false;

const timeout = setTimeout(() => {
  console.error("Smoke test timed out waiting for desktop bridge");
  cleanup(1);
}, 15_000);

function cleanup(code) {
  clearTimeout(timeout);
  electron.kill();
  server.kill();
  process.exit(code);
}

electron.stdout?.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (/preload bridge platform=(win32|darwin|linux)/.test(text)) {
    bridgeOk = true;
    console.log(
      "\n✓ Smoke test passed — Electron shell and preload bridge work\n",
    );
    cleanup(0);
  }
});

electron.stderr?.on("data", (chunk) => process.stderr.write(chunk));

electron.on("exit", (code) => {
  if (bridgeOk) return;
  console.error(`Smoke test failed (electron exit ${code ?? "unknown"})`);
  cleanup(code ?? 1);
});

#!/usr/bin/env node
/**
 * Launch @modelcontextprotocol/server-filesystem with explicit roots only.
 * Usage: node launch-filesystem.mjs /path/to/allowed/root
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const SUPERLOG_ENDPOINT = "https://intake.superlog.sh";
const SUPERLOG_PUBLIC_TOKEN = process.env.SUPERLOG_PUBLIC_TOKEN?.trim() ?? "";
const TELEMETRY_ENABLED =
  process.env.KEINSAAS_DESKTOP_TELEMETRY === "1" &&
  ["sl_public_", "superlog_live_"].some((prefix) =>
    SUPERLOG_PUBLIC_TOKEN.startsWith(prefix),
  );

/**
 * Reports a launcher failure as a single OTLP log record.
 *
 * Deliberately hand-rolled rather than using the OTel SDK: this process runs
 * with `stdio: "inherit"`, so its stdout *is* the MCP protocol stream. Anything
 * that might write a diagnostic line to the console — as the SDK does on export
 * failure — would corrupt the protocol. A bare awaited fetch has no such path,
 * and awaiting it is also the flush: a batch processor would drop this record
 * when the short-lived process exits.
 */
async function reportFailure(body, attributes) {
  if (!TELEMETRY_ENABLED) return;
  try {
    await fetch(`${SUPERLOG_ENDPOINT}/v1/logs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Ingest reads only `x-api-key` or `Authorization: Bearer <token>`.
        "x-api-key": SUPERLOG_PUBLIC_TOKEN,
      },
      body: JSON.stringify({
        resourceLogs: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: "keinsaas-mcp-stdio" },
                },
                {
                  key: "deployment.environment.name",
                  value: { stringValue: "desktop" },
                },
                {
                  key: "vcs.repository.url.full",
                  value: {
                    stringValue:
                      "https://github.com/keinsaasforever/keinsaas-navigator",
                  },
                },
              ],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: `${Date.now()}000000`,
                    severityNumber: 17,
                    severityText: "ERROR",
                    body: { stringValue: body },
                    attributes: Object.entries(attributes).map(
                      ([key, value]) => ({
                        key,
                        value: { stringValue: String(value) },
                      }),
                    ),
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
  } catch {
    // Never let telemetry stop the launcher from reporting its real exit code.
  }
}

const pkgDir = path.dirname(
  require.resolve("@modelcontextprotocol/server-filesystem/package.json"),
);
const serverEntry = path.join(pkgDir, "dist/index.js");

const roots = process.argv.slice(2).map((root) => path.resolve(root));

if (roots.length === 0) {
  console.error(
    "Usage: mcp-filesystem <allowed-directory> [more-directories...]",
  );
  process.exit(1);
}

const child = spawn(process.execPath, [serverEntry, ...roots], {
  stdio: "inherit",
  env: process.env,
});

child.on("error", async (error) => {
  await reportFailure("mcp-stdio filesystem server failed to spawn", {
    "app.operation": "mcp.stdio.spawn",
    "exception.type": error.name,
    "exception.message": error.message,
  });
  process.exit(1);
});

child.on("exit", async (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  if (code !== null && code !== 0) {
    await reportFailure("mcp-stdio filesystem server exited non-zero", {
      "app.operation": "mcp.stdio.exit",
      "process.exit_code": code,
      "app.root_count": roots.length,
    });
  }
  process.exit(code ?? 1);
});

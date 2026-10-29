#!/usr/bin/env node
/**
 * E2B sandbox diagnostics.
 *
 * Empirically answers "why does sandbox init fail?" by, for each template the
 * app enables for preview, attempting `Sandbox.create` (then immediately
 * killing it) and reporting: exists / not-found / auth error, plus cold-start
 * latency.
 *
 * Usage:
 *   E2B_API_KEY=... node scripts/e2b/diagnose.mjs
 *   E2B_API_KEY=... node scripts/e2b/diagnose.mjs nextjs-developer   # single template
 *
 * Requires `@e2b/code-interpreter` to be installed (it is an app dependency,
 * so run from the repo root after `pnpm install`).
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ALL_TEMPLATE_NAMES,
  COMMUNITY_PREVIEW_TEMPLATES,
} from "./template.mjs";

// The SDK is a dependency of apps/web (pnpm keeps it under apps/web/node_modules,
// not the repo root), so resolve it from that package rather than this script.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const webRequire = createRequire(
  pathToFileURL(join(repoRoot, "apps/web/package.json")),
);

// Derived from scripts/e2b/template.mjs so this list cannot drift from the one
// the app actually asks for. Set E2B_INCLUDE_CUSTOM_TEMPLATE=1 to also probe
// custom templates built by this repo.
const TEMPLATES =
  process.env.E2B_INCLUDE_CUSTOM_TEMPLATE === "1"
    ? ALL_TEMPLATE_NAMES
    : COMMUNITY_PREVIEW_TEMPLATES.map((template) => template.name);

async function main() {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) {
    console.error("✖ E2B_API_KEY is not set. Export it and re-run.");
    process.exit(1);
  }

  let Sandbox, NotFoundError, TemplateError, AuthenticationError, version;
  try {
    const sdkEntry = webRequire.resolve("@e2b/code-interpreter");
    const sdk = await import(pathToFileURL(sdkEntry).href);
    ({ Sandbox, NotFoundError, TemplateError, AuthenticationError } = sdk);
    version =
      webRequire("@e2b/code-interpreter/package.json").version ?? "unknown";
  } catch (err) {
    console.error(
      "✖ Could not load @e2b/code-interpreter. Run `pnpm install` first.",
    );
    console.error(`  ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  console.log(`E2B SDK @e2b/code-interpreter@${version}`);
  console.log(`Node ${process.version}\n`);

  const only = process.argv[2];
  const templates = only ? [only] : TEMPLATES;
  const rows = [];

  for (const template of templates) {
    const started = Date.now();
    let status = "OK";
    let detail = "";
    let sbx;
    try {
      sbx = await Sandbox.create(template, {
        apiKey,
        requestTimeoutMs: 30_000,
        timeoutMs: 10 * 60_000,
      });
      detail = `sbxId=${sbx.sandboxId}`;
    } catch (err) {
      if (err instanceof NotFoundError || err instanceof TemplateError) {
        status = "MISSING";
        detail = "template not built/published in this account";
      } else if (err instanceof AuthenticationError) {
        status = "AUTH";
        detail = "E2B_API_KEY rejected";
      } else {
        status = "ERROR";
        detail =
          err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }
    } finally {
      if (sbx) await sbx.kill().catch(() => {});
    }
    const ms = Date.now() - started;
    rows.push({ template, status, ms, detail });
    const icon = status === "OK" ? "✔" : status === "MISSING" ? "▲" : "✖";
    console.log(
      `${icon} ${template.padEnd(26)} ${status.padEnd(8)} ${String(ms).padStart(6)}ms  ${detail}`,
    );
  }

  const missing = rows.filter((r) => r.status === "MISSING");
  if (missing.length) {
    console.log(
      `\n${missing.length} template(s) missing: ${missing
        .map((r) => r.template)
        .join(", ")}`,
    );
    console.log(
      "→ Build them into this E2B account, or disable them in\n  apps/web/src/lib/e2b/sandbox-registry.ts.",
    );
  }
  if (rows.some((r) => r.status === "AUTH")) {
    console.log("\n→ E2B_API_KEY is invalid for this account/team.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

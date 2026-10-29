#!/usr/bin/env node

/**
 * Live, gated cold-start verification for every production preview template.
 *
 * Usage:
 *   E2B_LIVE_SMOKE=1 E2B_API_KEY=... pnpm e2b:smoke
 *   E2B_SMOKE_RUNS=5 may be used before re-enabling a rebuilt template.
 *   E2B_INCLUDE_CUSTOM_TEMPLATE=1 adds the custom preview template.
 *   E2B_INCLUDE_EXECUTION_TEMPLATES=1 adds the execution templates, which run
 *     real code and assert on the files it produced. Required before enabling
 *     navigator-python-docs in the registry.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ENABLED_PREVIEW_TEMPLATES = [
  {
    id: "nextjs-developer",
    path: "pages/index.tsx",
    port: 3000,
    content: "export default function Home(){return <main>E2B_SMOKE_OK</main>}",
  },
  {
    id: "vue-developer",
    path: "app/app.vue",
    port: 3000,
    content: "<template><main>E2B_SMOKE_OK</main></template>",
  },
  {
    id: "streamlit-developer",
    path: "app.py",
    port: 8501,
    content: 'import streamlit as st\nst.write("E2B_SMOKE_OK")\n',
  },
  {
    id: "gradio-developer",
    path: "app.py",
    port: 7860,
    content:
      'import gradio as gr\nwith gr.Blocks() as app:\n    gr.Markdown("E2B_SMOKE_OK")\napp.launch(server_name="0.0.0.0", server_port=7860)\n',
  },
];

const CUSTOM_TEMPLATE = {
  id: "navigator-remotion-nextjs",
  path: "pages/index.tsx",
  port: 3000,
  content: "export default function Home(){return <main>E2B_SMOKE_OK</main>}",
};

/**
 * Execution templates have no dev server to poll, so a preview-style check
 * would pass on an image whose code execution is broken. These run real code
 * instead and assert on the file it produced.
 *
 * The PDF checks are the point of `navigator-python-docs`: the libraries are
 * baked in precisely so no run has to pip install them, and a build that lost
 * one must fail here rather than in production as a ModuleNotFoundError.
 */
const EXECUTION_TEMPLATES = [
  {
    id: "navigator-python-docs",
    // No install line on purpose — an import that needs one is a failed build.
    code: [
      "from fpdf import FPDF",
      "from weasyprint import HTML",
      "import reportlab, pypdf",
      "pdf = FPDF(); pdf.add_page(); pdf.set_font('Helvetica', size=16)",
      "pdf.cell(0, 10, 'E2B_SMOKE_OK'); pdf.output('smoke.pdf')",
      "HTML(string='<h1>E2B_SMOKE_OK</h1>').write_pdf('smoke-html.pdf')",
      "print('E2B_SMOKE_OK')",
    ].join("\n"),
    expectFiles: ["smoke.pdf", "smoke-html.pdf"],
  },
];

/** Reads a produced file and asserts it really is a PDF. */
async function assertPdf(sandbox, filename) {
  const bytes = await sandbox.files.read(`/home/user/${filename}`, {
    format: "bytes",
  });
  const header = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  if (header !== "%PDF-") {
    throw new Error(`${filename} is not a PDF (starts with ${header})`);
  }
  if (bytes.byteLength < 100) {
    throw new Error(`${filename} is suspiciously small (${bytes.byteLength}B)`);
  }
}

async function smokeExecutionTemplate(Sandbox, template, run, runs) {
  const startedAt = Date.now();
  let sandbox;
  try {
    sandbox = await Sandbox.create(template.id, {
      apiKey: process.env.E2B_API_KEY,
      requestTimeoutMs: 30_000,
      timeoutMs: 5 * 60_000,
    });

    const execution = await sandbox.runCode(template.code, {
      language: "python",
      timeoutMs: 120_000,
    });
    if (execution.error) {
      throw new Error(`${execution.error.name}: ${execution.error.value}`);
    }
    for (const filename of template.expectFiles) {
      await assertPdf(sandbox, filename);
    }

    console.log(
      `PASS template=${template.id} run=${run}/${runs} durationMs=${Date.now() - startedAt}`,
    );
  } finally {
    if (sandbox) await sandbox.kill().catch(() => {});
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp200(url, budgetMs = 30_000) {
  const deadline = Date.now() + budgetMs;
  let lastStatus;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      lastStatus = response.status;
      if (response.status === 200) return;
    } catch {
      // The edge may not have a listener yet.
    }
    await delay(1_000);
  }
  throw new Error(`HTTP 200 not observed; last status=${lastStatus ?? "none"}`);
}

async function main() {
  if (process.env.E2B_LIVE_SMOKE !== "1") {
    console.log("SKIP: set E2B_LIVE_SMOKE=1 to run live E2B smoke tests.");
    return;
  }
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY is required for live smoke tests.");
  }

  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const webRequire = createRequire(
    pathToFileURL(join(repoRoot, "apps/web/package.json")),
  );
  const sdkEntry = webRequire.resolve("@e2b/code-interpreter");
  const { Sandbox } = await import(pathToFileURL(sdkEntry).href);
  const runs = Math.max(1, Number.parseInt(process.env.E2B_SMOKE_RUNS ?? "3"));
  const templates =
    process.env.E2B_INCLUDE_CUSTOM_TEMPLATE === "1"
      ? [...ENABLED_PREVIEW_TEMPLATES, CUSTOM_TEMPLATE]
      : ENABLED_PREVIEW_TEMPLATES;

  for (const template of templates) {
    for (let run = 1; run <= runs; run++) {
      const startedAt = Date.now();
      let sandbox;
      try {
        sandbox = await Sandbox.create(template.id, {
          apiKey: process.env.E2B_API_KEY,
          requestTimeoutMs: 30_000,
          secure: false,
          timeoutMs: 10 * 60_000,
        });
        await sandbox.files.write(template.path, template.content);
        const url = `https://${sandbox.getHost(template.port)}`;
        await waitForHttp200(url);
        console.log(
          `PASS template=${template.id} run=${run}/${runs} durationMs=${Date.now() - startedAt}`,
        );
      } finally {
        if (sandbox) await sandbox.kill().catch(() => {});
      }
    }
  }

  // Gated separately: the execution template must exist in the E2B account
  // before this can pass, and it is built after the preview templates.
  if (process.env.E2B_INCLUDE_EXECUTION_TEMPLATES === "1") {
    for (const template of EXECUTION_TEMPLATES) {
      for (let run = 1; run <= runs; run++) {
        await smokeExecutionTemplate(Sandbox, template, run, runs);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

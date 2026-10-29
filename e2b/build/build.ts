import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Template, defaultBuildLogger } from "e2b";
// @ts-expect-error - plain ESM, shared with scripts/e2b/{diagnose,smoke}.mjs so
// the template names cannot drift from the app's registry.
import { CUSTOM_TEMPLATES } from "../../scripts/e2b/template.mjs";

/**
 * Build one custom E2B template.
 *
 * Replaces `e2b template build`, the v1 CLI, which E2B removed: it now prints a
 * deprecation notice and exits without building anything. The repo's
 * `buildCommandFor()` assembled flags for that command, so the documented way to
 * build these images had quietly stopped working.
 *
 * The template data still comes from `scripts/e2b/template.mjs` rather than being
 * restated here. That file is what `diagnose.mjs` and `smoke.mjs` read, and
 * `sandbox-registry.test.ts` asserts its names match the app's registry — a
 * second copy of the names is exactly the drift those guards exist to catch.
 */

type CustomTemplate = {
  name: string;
  dockerfile: string;
  startCommand: string;
  readyCommand: string;
};

/**
 * Build resources, not sandbox resources.
 *
 * The v2 quickstart passes these on every example without saying what happens
 * when they are omitted, so they are passed explicitly rather than left to a
 * default that might change. Hobby plans allow up to 8 vCPU and 8 GiB per build;
 * this image is an apt install plus four pip packages, so it needs neither.
 */
const BUILD_CPU_COUNT = 2;
const BUILD_MEMORY_MB = 2048;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function templateByName(name: string): CustomTemplate {
  const templates = CUSTOM_TEMPLATES as CustomTemplate[];
  const found = templates.find((entry) => entry.name === name);
  if (!found) {
    const known = templates.map((entry) => entry.name).join(", ");
    throw new Error(`Unknown template "${name}". Known: ${known}`);
  }
  return found;
}

async function main() {
  const name = process.env.E2B_TEMPLATE?.trim();
  if (!name) {
    throw new Error(
      "E2B_TEMPLATE is required — naming the template keeps a mistyped or " +
        "defaulted build from silently replacing the wrong image.",
    );
  }
  if (!process.env.E2B_API_KEY?.trim()) {
    throw new Error("E2B_API_KEY is required.");
  }

  const definition = templateByName(name);

  // `fromDockerfile` takes the file's *contents*, and only understands FROM,
  // RUN, COPY, ADD, WORKDIR, USER, ENV, ARG, CMD and ENTRYPOINT. Both
  // Dockerfiles here stay inside that set; check it before adding an
  // instruction, because an unsupported one is dropped rather than rejected.
  const dockerfile = readFileSync(
    join(repoRoot, definition.dockerfile),
    "utf8",
  );

  // The ready command is passed as a raw shell string rather than through a
  // `waitForURL` helper: it is the same string `diagnose`/`smoke` and the old
  // CLI used, so one definition still describes the template everywhere.
  //
  // It runs in a loop until it exits 0, during the build, before the snapshot —
  // so anything that can never succeed hangs the build to its one-hour limit
  // instead of failing. That is why the library import check lives in the
  // Dockerfile as a RUN, where a missing package fails in seconds.
  const template = Template()
    .fromDockerfile(dockerfile)
    .setStartCmd(definition.startCommand, definition.readyCommand);

  console.log(`Building ${name} from ${definition.dockerfile}…`);
  await Template.build(template, name, {
    cpuCount: BUILD_CPU_COUNT,
    memoryMB: BUILD_MEMORY_MB,
    onBuildLogs: defaultBuildLogger(),
  });

  console.log(
    [
      ``,
      `Built ${name}.`,
      ``,
      `The app does NOT use it yet: getExecutionTemplateId() still returns`,
      `code-interpreter-v1 until E2B_EXECUTION_TEMPLATE names this template or`,
      `its registry entry is flipped to enabled: true. Verify first:`,
      ``,
      `  E2B_API_KEY=... pnpm e2b:diagnose`,
      `  E2B_LIVE_SMOKE=1 E2B_INCLUDE_EXECUTION_TEMPLATES=1 E2B_API_KEY=... pnpm e2b:smoke`,
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

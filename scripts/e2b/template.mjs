/**
 * Custom E2B templates this repo defines.
 *
 * Defines, not builds: `e2b/build/build.ts` reads this list and builds one with
 * the v2 SDK, and the **Build E2B template** GitHub Action runs it. Nothing
 * builds automatically on push — an image that takes minutes and costs build
 * minutes does not belong in the path of every commit.
 *
 * This was a set of single scalars, and the build command in package.json
 * re-typed every value by hand — so the two could silently drift, and there was
 * no way to express a second template at all. Everything is now driven from
 * this list: add an entry, and build/diagnose/smoke all pick it up.
 *
 * `name` must exactly match the key in
 * apps/web/src/lib/e2b/sandbox-registry.ts — the registry key is passed
 * verbatim to Sandbox.create, so a mismatch surfaces at runtime as a 502
 * template_not_available rather than at build time.
 *
 * Community templates (nextjs-developer, vue-developer, streamlit-developer,
 * gradio-developer, code-interpreter-v1) are NOT listed here: they are not
 * built by this repo and must already exist in the E2B account.
 */
export const CUSTOM_TEMPLATES = [
  {
    name: "navigator-remotion-nextjs",
    dockerfile: "./e2b.Dockerfile",
    // Note the `cd`: this image puts the app at /home/user/app, while the
    // sandbox default CWD is /home/user. Relative files.write() calls from the
    // app land in the default CWD, so a template whose app root is not the
    // default CWD will not see generated files. Prefer /home/user for new
    // templates.
    startCommand: "cd /home/user/app && npm run dev",
    readyCommand: "curl --fail --silent --show-error http://localhost:3000",
    port: 3000,
    entrypoint: "pages/index.tsx",
    packages: [
      "next@16.2.12",
      "react@19.2.8",
      "react-dom@19.2.8",
      "remotion@4.0.500",
      "@remotion/player@4.0.500",
    ],
  },
  {
    name: "navigator-python-docs",
    dockerfile: "./e2b.docs.Dockerfile",
    kind: "execution",
    // Copied verbatim from the upstream code-interpreter template's own docker
    // branch (e2b-dev/code-interpreter template/template.py). `runCode` talks
    // to the code-interpreter server this script starts on port 49999, so
    // replacing it with anything else — `sleep infinity` included — yields a
    // sandbox that boots and then fails every execution.
    startCommand: "sudo --preserve-env=E2B_LOCAL /root/.jupyter/start-up.sh",
    // The health check is what makes `runCode` safe to call. The library
    // imports used to be ANDed onto this, and moved into the Dockerfile as a
    // RUN: a ready command runs in a loop until it exits 0, so a broken
    // package hung the build to its one-hour limit instead of failing.
    readyCommand:
      "curl --fail --silent --show-error http://localhost:49999/health",
    port: null,
    entrypoint: "script.py",
    packages: [
      "reportlab==4.2.5",
      "fpdf2==2.8.2",
      "weasyprint==63.1",
      "pypdf==5.1.0",
    ],
  },
];

/**
 * Preview templates that must exist in the E2B account but are not built here.
 *
 * The scripts are plain ESM and cannot import the TypeScript registry, so this
 * is the script-side copy. `sandbox-registry.test.ts` asserts the two agree, so
 * drift fails the test suite rather than surfacing as a 502 in production.
 */
export const COMMUNITY_PREVIEW_TEMPLATES = [
  { name: "nextjs-developer", port: 3000, entrypoint: "pages/index.tsx" },
  { name: "vue-developer", port: 3000, entrypoint: "app/app.vue" },
  { name: "streamlit-developer", port: 8501, entrypoint: "app.py" },
  { name: "gradio-developer", port: 7860, entrypoint: "app.py" },
];

/** Every template the app may ask for — community previews plus everything built here. */
export const ALL_TEMPLATE_NAMES = [
  ...COMMUNITY_PREVIEW_TEMPLATES.map((template) => template.name),
  ...CUSTOM_TEMPLATES.map((template) => template.name),
];

export function getCustomTemplate(name) {
  return CUSTOM_TEMPLATES.find((template) => template.name === name);
}

if (process.argv[1]?.endsWith("template.mjs")) {
  console.log(JSON.stringify(CUSTOM_TEMPLATES, null, 2));
}

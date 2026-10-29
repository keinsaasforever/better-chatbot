# E2B template for Remotion + Next.js skills

This repository includes a custom E2B template Dockerfile and sandbox helpers so every sandbox session starts from the same preinstalled toolchain.

## Template files

- `e2b.Dockerfile`: installs Remotion + Next.js tooling and Vercel Skills CLI globally.
- `scripts/e2b/template.mjs`: source of truth for template name and CLI build command.

## Build and publish template

1. Install and authenticate the E2B CLI:

```bash
npm i -g @e2b/cli
e2b auth login
```

2. Build the template (requires `E2B_API_KEY` in your environment):

```bash
pnpm e2b:template:build
```

This publishes the template as `navigator-remotion-nextjs` to your E2B account.

## Runtime usage in app code

`src/lib/e2b/sandbox.ts` exposes three helpers:

- `createNavigatorSandbox()` — creates a sandbox from the `navigator-remotion-nextjs` template.
- `ensureTemplateTools(sandbox)` — verifies that `remotion`, `next`, and `create-video` binaries are available.
- `executeJavascriptInSandbox(code, sandbox?)` — runs JavaScript in the sandbox.

Every user gets the same sandbox base with Remotion and Next.js preinstalled instead of installing them on every run.

## AI tool

The `e2b-sandbox` tool (`src/lib/ai/tools/code/e2b-sandbox-tool.ts`) includes `navigator-remotion-nextjs` in its template enum. The model will select this template when the user asks to create a Remotion video or a Next.js app that requires pre-built video tooling.

## Updating the template

Edit `e2b.Dockerfile`, then run the **Build E2B template** GitHub Action and pick
`navigator-remotion-nextjs`. It needs no local clone, no Docker and no E2B CLI —
only the `E2B_API_KEY` repository secret.

To build from a checkout instead: `E2B_TEMPLATE=navigator-remotion-nextjs E2B_API_KEY=... pnpm e2b:template:build`.

The template's `name` in `scripts/e2b/template.mjs` is passed verbatim to
`Sandbox.create`, so it must match its key in `apps/web/src/lib/e2b/sandbox-registry.ts`
— `sandbox-registry.test.ts` fails the build if the two drift.

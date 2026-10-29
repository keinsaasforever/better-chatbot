import { afterEach, describe, expect, test } from "vitest";
import {
  ENABLED_PREVIEW_TEMPLATE_IDS,
  describeEnabledPreviewEntrypoints,
  describeEnabledPreviewPorts,
  describeEnabledPreviewTemplates,
  getEnabledPreviewTemplate,
  getExecutionTemplateId,
  getSandboxTemplate,
  hasPreinstalledDocumentLibraries,
} from "./sandbox-registry";

describe("sandbox template registry", () => {
  test("only production-enabled preview templates are exposed", () => {
    expect(ENABLED_PREVIEW_TEMPLATE_IDS).toEqual([
      "nextjs-developer",
      "vue-developer",
      "streamlit-developer",
      "gradio-developer",
    ]);
  });

  test("rejects the execution-only interpreter as a preview", () => {
    expect(getSandboxTemplate("code-interpreter-v1")?.kind).toBe("execution");
    expect(getEnabledPreviewTemplate("code-interpreter-v1")).toBeUndefined();
  });

  test("enables the document template now that its image is built", () => {
    // Enabled only after Actions → Build E2B template published it. An
    // enabled-but-unbuilt id is not a validation error: it 404s on every
    // execution at runtime, which is how it took production down once.
    expect(getSandboxTemplate("navigator-python-docs")?.enabled).toBe(true);
    // Still never a preview — it exposes no dev server to iframe.
    expect(getEnabledPreviewTemplate("navigator-python-docs")).toBeUndefined();
  });

  test("keeps the custom template disabled for data-only rollback", () => {
    expect(getSandboxTemplate("navigator-remotion-nextjs")?.enabled).toBe(
      false,
    );
    expect(
      getEnabledPreviewTemplate("navigator-remotion-nextjs"),
    ).toBeUndefined();
  });
});

describe("script-side template list", () => {
  // scripts/e2b/*.mjs are plain ESM and cannot import this TypeScript module,
  // so they keep their own copy of the ids. A silent divergence would mean
  // `pnpm e2b:diagnose` reports a clean bill of health for templates the app
  // actually asks for — the exact gap those scripts exist to close.
  test("matches the enabled preview templates in the registry", async () => {
    const { COMMUNITY_PREVIEW_TEMPLATES, CUSTOM_TEMPLATES } = await import(
      "../../../../../scripts/e2b/template.mjs"
    );

    const scriptSide = [
      ...COMMUNITY_PREVIEW_TEMPLATES.map((t: { name: string }) => t.name),
      ...CUSTOM_TEMPLATES.map((t: { name: string }) => t.name),
    ];

    // Every template the app can request must be known to the scripts.
    for (const id of ENABLED_PREVIEW_TEMPLATE_IDS) {
      expect(scriptSide).toContain(id);
    }
    // And every custom template the scripts build must be in the registry,
    // enabled or not — otherwise we ship an image nothing can select.
    for (const custom of CUSTOM_TEMPLATES as Array<{ name: string }>) {
      expect(getSandboxTemplate(custom.name)).toBeDefined();
    }
  });
});

describe("generated tool guidance", () => {
  // The tool used to carry this per-template guidance as hand-written prose, so
  // adding a registry entry made it selectable by the model while telling it
  // nothing about which file to write or which port to use.
  test("covers every enabled template with an entrypoint and port", () => {
    const described = describeEnabledPreviewTemplates();
    for (const id of ENABLED_PREVIEW_TEMPLATE_IDS) {
      const definition = getSandboxTemplate(id)!;
      expect(described).toContain(id);
      expect(described).toContain(definition.entrypoint);
    }
    expect(describeEnabledPreviewPorts()).toContain("streamlit-developer=8501");
    expect(describeEnabledPreviewEntrypoints()).toContain(
      "vue-developer → app/app.vue",
    );
  });

  test("omits templates that are disabled", () => {
    expect(describeEnabledPreviewTemplates()).not.toContain(
      "navigator-remotion-nextjs",
    );
  });
});

describe("execution template resolution", () => {
  const original = process.env.E2B_EXECUTION_TEMPLATE;
  afterEach(() => {
    if (original === undefined) delete process.env.E2B_EXECUTION_TEMPLATE;
    else process.env.E2B_EXECUTION_TEMPLATE = original;
  });

  test("defaults to the docs image now that it is built", () => {
    delete process.env.E2B_EXECUTION_TEMPLATE;
    expect(getExecutionTemplateId()).toBe("navigator-python-docs");
    // Which is what lets create-pdf be offered at all, and what stops the
    // Python tool telling the model to pip install what is already there.
    expect(hasPreinstalledDocumentLibraries()).toBe(true);
  });

  test("honours the env override, the deploy-free rollback", () => {
    process.env.E2B_EXECUTION_TEMPLATE = "navigator-python-docs";
    expect(getExecutionTemplateId()).toBe("navigator-python-docs");
    expect(hasPreinstalledDocumentLibraries()).toBe(true);

    process.env.E2B_EXECUTION_TEMPLATE = "code-interpreter-v1";
    expect(getExecutionTemplateId()).toBe("code-interpreter-v1");
  });

  test("ignores a blank override rather than asking for template ''", () => {
    process.env.E2B_EXECUTION_TEMPLATE = "   ";
    expect(getExecutionTemplateId()).toBe("navigator-python-docs");
  });

  // The rollback path, and the one that matters after an incident: naming the
  // stock image beats editing the registry and waiting for a deploy.
  test("the env override still rolls back to the stock interpreter", () => {
    process.env.E2B_EXECUTION_TEMPLATE = "code-interpreter-v1";
    expect(getExecutionTemplateId()).toBe("code-interpreter-v1");
    expect(hasPreinstalledDocumentLibraries()).toBe(false);
  });
});

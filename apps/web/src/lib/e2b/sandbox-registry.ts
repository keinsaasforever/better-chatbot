export type SandboxTemplateKind = "preview" | "execution";

export interface SandboxTemplateDefinition {
  kind: SandboxTemplateKind;
  enabled: boolean;
  defaultPort?: number;
  /** Path the model writes its main file to, relative to the sandbox CWD. */
  entrypoint: string;
  label: string;
  /**
   * What the model needs to know to target this template: pre-installed
   * tooling and any template-specific trap. Rendered into the e2b-sandbox tool
   * description, so adding a template here cannot leave the model uninformed
   * about it — that guidance used to be hand-maintained prose in the tool.
   */
  guidance?: string;
}

/**
 * The production source of truth for sandbox capabilities.
 *
 * Removing a template from the preview allowlist is deliberately a data-only
 * rollback. Execution-only templates remain registered so callers receive a
 * useful validation error instead of silently treating them as previews.
 */
export const SANDBOX_TEMPLATE_REGISTRY = {
  "nextjs-developer": {
    kind: "preview",
    enabled: true,
    defaultPort: 3000,
    entrypoint: "pages/index.tsx",
    label: "React/Next.js",
    guidance:
      "Pages Router. Tailwind CSS + shadcn/ui pre-installed at @/components/ui/* — do not reinstall. Style with Tailwind utility classes, not large inline-style objects. Never also create app/page.tsx (route conflict).",
  },
  "vue-developer": {
    kind: "preview",
    enabled: true,
    defaultPort: 3000,
    entrypoint: "app/app.vue",
    label: "Vue/Nuxt",
    guidance: "Vue 3 / Nuxt.",
  },
  "streamlit-developer": {
    kind: "preview",
    enabled: true,
    defaultPort: 8501,
    entrypoint: "app.py",
    label: "Streamlit",
    guidance:
      "Streamlit + pandas/numpy/matplotlib/plotly pre-installed. For tables use st.dataframe/st.table — NOT st.markdown with raw HTML, which renders as visible text unless unsafe_allow_html=True.",
  },
  "gradio-developer": {
    kind: "preview",
    enabled: true,
    defaultPort: 7860,
    entrypoint: "app.py",
    label: "Gradio",
    guidance: "Gradio + pandas/numpy/matplotlib pre-installed.",
  },
  "navigator-remotion-nextjs": {
    kind: "preview",
    enabled: false,
    defaultPort: 3000,
    entrypoint: "pages/index.tsx",
    label: "Remotion/Next.js",
  },
  // HTML -> PDF. Ships WeasyPrint and its system libraries preinstalled, which
  // code-interpreter-v1 cannot do.
  //
  // Enabled once the image was actually built into the E2B account — a registry
  // entry does not create the template, and an enabled-but-unbuilt id fails at
  // runtime as a 404 on every execution, which is exactly how it took
  // production down when E2B_EXECUTION_TEMPLATE named it early. The build
  // (Actions → Build E2B template) verifies the library imports and the
  // code-interpreter health check before it publishes.
  "navigator-python-docs": {
    kind: "execution",
    enabled: true,
    entrypoint: "script.py",
    label: "Python code interpreter with document libraries",
  },
  "code-interpreter-v1": {
    kind: "execution",
    enabled: true,
    entrypoint: "script.py",
    label: "Python code interpreter",
  },
} as const satisfies Record<string, SandboxTemplateDefinition>;

export type SandboxTemplateId = keyof typeof SANDBOX_TEMPLATE_REGISTRY;

/** Template id used for every code execution, before the env override. */
const DEFAULT_EXECUTION_TEMPLATE_ID = "navigator-python-docs";

/**
 * The stock interpreter, and the floor every execution can fall back to.
 *
 * E2B publishes it for every account, so it is the one execution template that
 * cannot be missing. `e2bRun` falls back to it when the configured template
 * turns out not to exist, which is the difference between "PDF libraries are
 * missing" and "no code runs at all".
 */
export const STOCK_EXECUTION_TEMPLATE_ID = "code-interpreter-v1";

/**
 * The template every Python/JS execution runs in.
 *
 * `navigator-python-docs` is `code-interpreter-v1` plus reportlab, fpdf2,
 * weasyprint and pypdf, so a PDF request stops depending on the model
 * remembering to pip install. It stays disabled in the registry until the
 * image is built and `pnpm e2b:diagnose` + `pnpm e2b:smoke` pass, because an
 * enabled-but-unbuilt id fails at runtime as a 502 rather than at validation.
 *
 * `E2B_EXECUTION_TEMPLATE` is the rollback: set it to `code-interpreter-v1` to
 * go back to the stock image without a deploy.
 *
 * The override is deliberately not validated against the registry — pointing at
 * a template before flipping its entry is the whole point of it. That makes it
 * possible to name a template E2B does not have, which took production down
 * once; `e2bRun` handles that at runtime by falling back to
 * {@link STOCK_EXECUTION_TEMPLATE_ID}.
 */
export function getExecutionTemplateId(): string {
  const override = process.env.E2B_EXECUTION_TEMPLATE?.trim();
  if (override) return override;

  return SANDBOX_TEMPLATE_REGISTRY[DEFAULT_EXECUTION_TEMPLATE_ID].enabled
    ? DEFAULT_EXECUTION_TEMPLATE_ID
    : STOCK_EXECUTION_TEMPLATE_ID;
}

/**
 * Whether the active execution template has the document libraries baked in.
 *
 * Drives two things that must not disagree with reality: the Python tool tells
 * the model to pip install only when it has to, and `create-pdf` (which needs
 * WeasyPrint and has no pip-install escape hatch) is only registered when it
 * can actually work.
 */
export function hasPreinstalledDocumentLibraries(): boolean {
  return getExecutionTemplateId() === DEFAULT_EXECUTION_TEMPLATE_ID;
}

export const ENABLED_PREVIEW_TEMPLATE_IDS = Object.entries(
  SANDBOX_TEMPLATE_REGISTRY,
)
  .filter(([, definition]) => {
    return definition.kind === "preview" && definition.enabled;
  })
  .map(([id]) => id) as SandboxTemplateId[];

export function getSandboxTemplate(
  template: string,
): SandboxTemplateDefinition | undefined {
  return SANDBOX_TEMPLATE_REGISTRY[template as SandboxTemplateId] as
    | SandboxTemplateDefinition
    | undefined;
}

export function getEnabledPreviewTemplate(
  template: string,
): SandboxTemplateDefinition | undefined {
  const definition = getSandboxTemplate(template);
  if (definition?.kind !== "preview" || !definition.enabled) return undefined;
  return definition;
}

/** The enabled preview templates, with everything the model needs to target them. */
export function getEnabledPreviewTemplates(): Array<
  SandboxTemplateDefinition & { id: string }
> {
  return ENABLED_PREVIEW_TEMPLATE_IDS.map((id) => ({
    id,
    ...(SANDBOX_TEMPLATE_REGISTRY[id] as SandboxTemplateDefinition),
  }));
}

/**
 * Renders the per-template guidance the e2b-sandbox tool shows the model.
 *
 * Generated rather than hand-written: the entrypoint and port used to be
 * duplicated in three prose strings in the tool, so a template added here was
 * selectable by the model while it had no idea what file to write or which port
 * to use.
 */
export function describeEnabledPreviewTemplates(): string {
  return getEnabledPreviewTemplates()
    .map((template) => {
      const port = template.defaultPort
        ? ` (port ${template.defaultPort})`
        : "";
      const guidance = template.guidance ? ` ${template.guidance}` : "";
      return `- ${template.id} → ${template.label}. Entry: ${template.entrypoint}${port}.${guidance}`;
    })
    .join("\n");
}

/** One-line summary for the `template` enum description. */
export function summarizeEnabledPreviewTemplates(): string {
  return getEnabledPreviewTemplates()
    .map((template) => `${template.id} (${template.label})`)
    .join(", ");
}

/** Per-template entrypoint mapping for the `file_path` description. */
export function describeEnabledPreviewEntrypoints(): string {
  return getEnabledPreviewTemplates()
    .map((template) => `${template.id} → ${template.entrypoint}`)
    .join("; ");
}

/** Per-template port mapping for the `port` description. */
export function describeEnabledPreviewPorts(): string {
  return getEnabledPreviewTemplates()
    .filter((template) => template.defaultPort)
    .map((template) => `${template.id}=${template.defaultPort}`)
    .join(", ");
}

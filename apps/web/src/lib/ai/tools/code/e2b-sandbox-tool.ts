import { tool as createTool } from "ai";
import { JSONSchema7 } from "json-schema";
import {
  ENABLED_PREVIEW_TEMPLATE_IDS,
  describeEnabledPreviewEntrypoints,
  describeEnabledPreviewPorts,
  describeEnabledPreviewTemplates,
  summarizeEnabledPreviewTemplates,
} from "lib/e2b/sandbox-registry";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";

export const e2bSandboxSchema: JSONSchema7 = {
  type: "object",
  properties: {
    template: {
      type: "string",
      enum: ENABLED_PREVIEW_TEMPLATE_IDS,
      description: `Preview template: ${summarizeEnabledPreviewTemplates()}.`,
    },
    title: {
      type: "string",
      description: "Short title for the app (max 4 words).",
    },
    file_path: {
      type: "string",
      description: `Relative path for the main file inside the sandbox. Per template: ${describeEnabledPreviewEntrypoints()}. For nextjs-developer this is the Pages Router — overwrite that file, do NOT create app/page.tsx. Additional pages: pages/about.tsx for /about.`,
    },
    code: {
      type: "string",
      description: "Full source code to write to file_path.",
    },
    port: {
      type: ["number", "null"],
      description: `Port the app's dev server listens on. Use the template default: ${describeEnabledPreviewPorts()}.`,
    },
    has_additional_dependencies: {
      type: "boolean",
      description:
        "True when extra packages beyond the template defaults are needed.",
    },
    install_dependencies_command: {
      type: "string",
      description:
        "Shell command to install extra packages (e.g. 'npm install recharts' or 'pip install seaborn').",
    },
  },
  required: ["template", "title", "file_path", "code"],
};

export const e2bSandboxTool = createTool({
  description: `Create and run a live web application in a cloud sandbox and show it in a preview panel. Use this when the user asks you to:
- Build a website, web app, dashboard, or interactive UI
- Create a React/Next.js, Vue, Streamlit, or Gradio application
- Generate a full working app the user can see and interact with
- Create an interactive data application

Images and files the user uploaded are already hosted at public URLs — reference them straight from your markup (\`<img src="THE_URL">\`). Never base64-encode them into the code and never try to write them into the sandbox filesystem: the payload limit below applies to your arguments, and a URL keeps working after the sandbox is gone.

Do NOT use this for calculations, data analysis, or one-off scripts — use javascript-execution or python-execution.
Do NOT use this to produce a downloadable file (PDF, CSV, Excel, image) with no web UI — use create-pdf for a prose document, or python-execution for anything computed; both return the file as a download. Only route document generation to external integrations if the user names one.

Templates — pick one, then write the entrypoint below. Each ships the listed tooling PRE-INSTALLED (don't reinstall it):
${describeEnabledPreviewTemplates()}
Keep the code compact: it is sent as this tool's arguments, and very large code can be truncated and rejected as "Invalid sandbox payload". Prefer Tailwind utility classes over verbose inline styles, flat JSX over deep nesting, and .map() over repeated markup. If you hit "Invalid sandbox payload", the code was likely incomplete/too large — retry with a minimal version first, then add detail.`,
  inputSchema: jsonSchemaToZod(e2bSandboxSchema),
});

import { type UIMessage, getToolName, isToolUIPart } from "ai";
import { DefaultToolName } from "lib/ai/tools";
import { defaultUrlTransform } from "react-markdown";

/**
 * Turning the links a model writes to generated files into real downloads.
 *
 * Models trained on hosted code interpreters write `sandbox:/home/user/x.xlsx`
 * or just `x.xlsx` when they mean "the file I just made". Nothing serves those.
 * The file's real URL is in the same message, in the code tool's output, so
 * the markdown renderer can look it up by name.
 */

export type LinkableArtifact = { filename: string; url?: string };

const SANDBOX_SCHEMES = /^(sandbox|attachment|file):/i;
const SANDBOX_PATHS = /^\/(home\/user|mnt)\//i;
/** `report.xlsx`, `./report.xlsx`, `out/report.xlsx`: no scheme, no host. */
const BARE_FILE = /^(\.\/)?[^/:?#\s]+(\/[^/:?#\s]+)*\.[a-z0-9]{1,6}$/i;

/** A link that can only mean a file in the sandbox, never a web address. */
export function isSandboxLikeHref(href: string | undefined): href is string {
  if (!href) return false;
  return (
    SANDBOX_SCHEMES.test(href) ||
    SANDBOX_PATHS.test(href) ||
    BARE_FILE.test(href)
  );
}

/** The app's own durable download route (what the tool output carries). */
export function isAppDownloadHref(href: string | undefined): href is string {
  return !!href && /^\/api\/storage\/download\?/.test(href);
}

function basenameOf(href: string): string {
  const withoutScheme = href.replace(/^[a-z]+:\/*/i, "");
  const path = withoutScheme.split(/[?#]/)[0] ?? "";
  const last = path.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** The generated file a sandbox-style link refers to, by name. */
export function resolveArtifactLink(
  href: string,
  artifacts: LinkableArtifact[],
): LinkableArtifact | null {
  const name = basenameOf(href);
  if (!name) return null;
  const lower = name.toLowerCase();
  return (
    artifacts.find((artifact) => artifact.filename === name) ??
    artifacts.find((artifact) => artifact.filename.toLowerCase() === lower) ??
    null
  );
}

const CODE_TOOL_NAMES = new Set<string>([
  DefaultToolName.PythonExecution,
  DefaultToolName.JavascriptExecution,
]);

/**
 * Generated files of one message: every finished code-tool output's
 * `artifacts`. The signature is a stable string of the same data, so a
 * provider can keep one array reference across stream ticks.
 */
export function collectMessageArtifacts(parts: UIMessage["parts"]): {
  artifacts: LinkableArtifact[];
  signature: string;
} {
  const artifacts: LinkableArtifact[] = [];
  for (const part of parts) {
    if (!isToolUIPart(part) || part.type === "dynamic-tool") continue;
    if (!CODE_TOOL_NAMES.has(getToolName(part))) continue;
    if (part.state !== "output-available") continue;
    const output = part.output as
      | { artifacts?: Array<{ filename?: unknown; url?: unknown }> }
      | undefined;
    for (const artifact of output?.artifacts ?? []) {
      if (typeof artifact?.filename !== "string") continue;
      artifacts.push({
        filename: artifact.filename,
        url: typeof artifact.url === "string" ? artifact.url : undefined,
      });
    }
  }
  return {
    artifacts,
    signature: artifacts.map((a) => `${a.filename}|${a.url ?? ""}`).join("\n"),
  };
}

/**
 * react-markdown's default transform blanks any href whose scheme it does not
 * know — `sandbox:` included — before a component override ever sees it. Keep
 * sandbox-style hrefs so the link renderer can resolve them; everything else
 * gets the default treatment (so `javascript:` stays blocked).
 */
export function markdownUrlTransform(url: string): string {
  return isSandboxLikeHref(url) ? url : defaultUrlTransform(url);
}

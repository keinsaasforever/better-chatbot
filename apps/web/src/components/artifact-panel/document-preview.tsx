"use client";

import {
  type DocumentPreviewBody,
  useDocumentPreview,
} from "@/hooks/queries/use-document-preview";
import {
  type ArtifactFile,
  artifactStorageKey,
} from "lib/code-runner/artifact-media";
import { cn } from "lib/utils";
import { useTranslations } from "next-intl";
import { Skeleton } from "ui/skeleton";
import { FileDownloadFallback } from "./file-download-fallback";

/**
 * A .docx, .pptx or text file in the panel.
 *
 * Everything is parsed on the server (`/api/storage/document`) and arrives as
 * JSON. Nothing is parsed in the browser and the file itself is never
 * downloaded here — the panel's Download button is the only thing that fetches
 * the bytes.
 *
 * Every failure — too large, unreadable, gone, switched off — falls back to the
 * download, which is what the panel offered before this existed.
 */
export function DocumentPreview({ file }: { file: ArtifactFile }) {
  const t = useTranslations("Chat.Artifact");
  const storageKey = artifactStorageKey(file.url);
  const { preview, isLoading, isError, reason } =
    useDocumentPreview(storageKey);

  if (reason === "too_large") {
    return <FileDownloadFallback file={file} message={t("documentTooLarge")} />;
  }
  if (isError || !storageKey) {
    return (
      <FileDownloadFallback file={file} message={t("documentLoadFailed")} />
    );
  }
  if (isLoading || !preview) {
    return (
      <div className="h-full space-y-3 p-6">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-4/5" />
        <span className="sr-only">{t("documentLoading")}</span>
      </div>
    );
  }

  if (preview.kind === "slides") return <Slides preview={preview} />;
  if (preview.kind === "text") return <Text preview={preview} />;
  return <RenderedDocument html={preview.html} />;
}

/**
 * The document's own HTML, rendered where it can do nothing.
 *
 * `sandbox=""` with no tokens is the strictest setting there is: no scripts, no
 * popups, no top-level navigation, and a unique opaque origin, so the frame
 * cannot reach this page's DOM, cookies or storage. The CSP inside the document
 * is the second layer and covers what the sandbox does not — `default-src
 * 'none'` means no image, font, frame or fetch of any kind leaves the frame,
 * so a document cannot phone home simply by being opened. Styles are the one
 * exception, and only inline ones.
 *
 * `srcDoc` rather than a URL: serving this HTML from our own origin would put
 * user-authored markup on it, which is exactly the boundary the storage route's
 * inline-content allowlist exists to hold.
 */
function RenderedDocument({ html }: { html: string }) {
  const page = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 24px;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
    font-size: 14px; line-height: 1.6;
    color: #18181b; background: transparent;
  }
  @media (prefers-color-scheme: dark) { body { color: #e4e4e7; } }
  h1, h2, h3, h4 { line-height: 1.3; margin: 1.2em 0 0.4em; }
  p { margin: 0 0 0.8em; }
  table { border-collapse: collapse; margin: 1em 0; }
  td, th { border: 1px solid rgba(128,128,128,0.4); padding: 4px 8px; text-align: left; }
  /* Anchors are already spans by the time they get here; this covers a
     future mammoth version that emits one anyway. */
  a { pointer-events: none; text-decoration: underline; }
  img { display: none; }
</style>
</head><body>${html}</body></html>`;

  return (
    <iframe
      // React escapes the attribute value, so a quote in the document cannot
      // break out of `srcdoc` — asserted in the tests.
      srcDoc={page}
      sandbox=""
      referrerPolicy="no-referrer"
      className="h-full w-full border-0 bg-muted/20"
      title="Document preview"
    />
  );
}

function Slides({
  preview,
}: {
  preview: Extract<DocumentPreviewBody, { kind: "slides" }>;
}) {
  const t = useTranslations("Chat.Artifact");

  if (!preview.slides.length) {
    return (
      <p className="p-8 text-center text-xs text-muted-foreground">
        {t("slidesEmpty")}
      </p>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="space-y-3">
        {preview.slides.map((slide) => (
          <article
            key={slide.index}
            className={cn(
              "rounded-lg border bg-background p-4",
              slide.hidden && "opacity-60",
            )}
          >
            <header className="mb-2 flex items-baseline gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">
                {slide.index}
              </span>
              <h3 className="text-sm font-medium">{slide.title}</h3>
              {slide.hidden && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("slideHidden")}
                </span>
              )}
            </header>
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">
              {slide.text}
            </p>
          </article>
        ))}
      </div>
      {/* Said once, at the end, rather than on every card: the preview is text
          and the user should know what it is not. */}
      <p className="px-1 py-3 text-center text-[11px] text-muted-foreground">
        {t("slidesPartial")}
      </p>
    </div>
  );
}

function Text({
  preview,
}: {
  preview: Extract<DocumentPreviewBody, { kind: "text" }>;
}) {
  const t = useTranslations("Chat.Artifact");

  return (
    <div className="h-full overflow-auto">
      {preview.replacedInvalidBytes && (
        <p className="border-b bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {t("textDecodeWarning")}
        </p>
      )}
      <pre className="whitespace-pre-wrap break-words p-4 font-mono text-xs">
        {preview.text}
      </pre>
      {preview.truncated && (
        <p className="border-t px-3 py-2 text-center text-[11px] text-muted-foreground">
          {t("textTruncated")}
        </p>
      )}
    </div>
  );
}

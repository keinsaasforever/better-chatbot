// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ArtifactFile } from "lib/code-runner/artifact-media";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test, vi } from "vitest";
import messages from "../../../messages/en.json";

const mocks = vi.hoisted(() => ({ useDocumentPreview: vi.fn() }));

vi.mock("@/hooks/queries/use-document-preview", () => ({
  useDocumentPreview: mocks.useDocumentPreview,
}));

import { DocumentPreview } from "./document-preview";

const file: ArtifactFile = {
  filename: "contract.docx",
  url: "/api/storage/download?key=user_1%2Fuuid-contract.docx",
  mimeType:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function renderPreview(preview: unknown, extra: Record<string, unknown> = {}) {
  mocks.useDocumentPreview.mockReturnValue({
    preview,
    isLoading: false,
    isError: false,
    reason: undefined,
    ...extra,
  });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DocumentPreview file={file} />
    </NextIntlClientProvider>,
  );
}

const frame = () => document.querySelector("iframe");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DocumentPreview", () => {
  describe("the frame a document is rendered in", () => {
    test("is sandboxed with no tokens and sends no referrer", () => {
      renderPreview({
        kind: "document",
        html: "<p>Hello</p>",
        truncated: false,
      });

      // `sandbox=""` is the strictest setting there is: no scripts, no popups,
      // no top-level navigation, and an opaque origin, so the frame cannot
      // reach this page's DOM, cookies or storage.
      expect(frame()?.getAttribute("sandbox")).toBe("");
      expect(frame()?.getAttribute("referrerpolicy")).toBe("no-referrer");
      expect(frame()?.getAttribute("src")).toBeNull();
    });

    test("carries a CSP that lets nothing but inline styles happen", () => {
      renderPreview({
        kind: "document",
        html: "<p>Hello</p>",
        truncated: false,
      });
      const srcdoc = frame()?.getAttribute("srcdoc") ?? "";

      expect(srcdoc).toContain("Content-Security-Policy");
      // No image, font, frame or fetch of any kind leaves the frame, so a
      // document cannot phone home simply by being opened.
      expect(srcdoc).toContain("default-src 'none'");
      expect(srcdoc).toContain("style-src 'unsafe-inline'");
      expect(srcdoc).toContain("base-uri 'none'");
      expect(srcdoc).toContain("form-action 'none'");
    });

    test("keeps hostile markup inside the frame document", () => {
      renderPreview({
        kind: "document",
        html: '<script>alert(1)</script><style>body{}</style></body><img src="https://tracker.test/x">',
        truncated: false,
      });

      // Everything stays in the attribute value: React escapes it, so nothing
      // reaches this page's DOM.
      expect(document.querySelector("script")).toBeNull();
      expect(document.querySelector("img")).toBeNull();
      expect(frame()?.getAttribute("srcdoc")).toContain("alert(1)");
    });

    test("a quote in the document cannot break out of the attribute", () => {
      renderPreview({
        kind: "document",
        html: '<p>He said "no" onload="alert(1)"</p>',
        truncated: false,
      });

      // Read back as an attribute value, the quotes are content — if they had
      // broken out, this would not round-trip.
      expect(frame()?.getAttribute("srcdoc")).toContain(
        '<p>He said "no" onload="alert(1)"</p>',
      );
      expect(frame()?.getAttribute("onload")).toBeNull();
    });
  });

  describe("slides", () => {
    test("shows one card per slide and says the preview is text only", () => {
      renderPreview({
        kind: "slides",
        slides: [
          { index: 1, title: "Q1", text: "Revenue up", hidden: false },
          { index: 2, title: "Backup", text: "Detail", hidden: true },
        ],
        totalSlides: 2,
        skipped: 0,
        truncated: false,
        partial: true,
      });

      expect(screen.getByText("Q1")).toBeTruthy();
      expect(screen.getByText("Revenue up")).toBeTruthy();
      expect(screen.getByText(messages.Chat.Artifact.slideHidden)).toBeTruthy();
      expect(
        screen.getByText(messages.Chat.Artifact.slidesPartial),
      ).toBeTruthy();
    });

    test("says so when no slide could be read", () => {
      renderPreview({
        kind: "slides",
        slides: [],
        totalSlides: 0,
        skipped: 0,
        truncated: false,
        partial: true,
      });

      expect(screen.getByText(messages.Chat.Artifact.slidesEmpty)).toBeTruthy();
    });
  });

  describe("text", () => {
    test("warns when bytes had to be replaced", () => {
      renderPreview({
        kind: "text",
        text: "caf�",
        truncated: true,
        replacedInvalidBytes: true,
      });

      expect(
        screen.getByText(messages.Chat.Artifact.textDecodeWarning),
      ).toBeTruthy();
      expect(
        screen.getByText(messages.Chat.Artifact.textTruncated),
      ).toBeTruthy();
    });
  });

  describe("failures", () => {
    test("offers the download when the document is too large", () => {
      renderPreview(undefined, { reason: "too_large", isError: true });

      expect(
        screen.getByText(messages.Chat.Artifact.documentTooLarge),
      ).toBeTruthy();
      expect(frame()).toBeNull();
    });

    test("offers the download when the parse failed", () => {
      renderPreview(undefined, { isError: true });

      expect(
        screen.getByText(messages.Chat.Artifact.documentLoadFailed),
      ).toBeTruthy();
    });
  });
});

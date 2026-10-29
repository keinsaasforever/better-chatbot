// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ArtifactFile } from "lib/code-runner/artifact-media";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test } from "vitest";
import messages from "../../../messages/en.json";
import { ArtifactPanel } from "./artifact-panel";
import { ArtifactPanelProvider } from "./artifact-panel-context";
import { FileArtifactChip } from "./file-artifact-chip";

const STORED = "/api/storage/download?key=user_1%2Fuuid-report.pdf";

const pdf: ArtifactFile = {
  filename: "report.pdf",
  url: STORED,
  previewUrl: `${STORED}&disposition=inline`,
  mimeType: "application/pdf",
};

function part(toolCallId = "tool_1") {
  return {
    type: "tool-python-execution",
    toolCallId,
    state: "output-available",
    input: { code: "pdf.output('report.pdf')" },
    output: {},
  } as never;
}

function renderChip(file: ArtifactFile = pdf, autoOpen = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ArtifactPanelProvider>
        <FileArtifactChip part={part()} file={file} autoOpen={autoOpen} />
        <ArtifactPanel />
      </ArtifactPanelProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("FileArtifactChip", () => {
  test("names the file and opens it in the panel on click", () => {
    renderChip();

    // The panel stays closed until asked.
    expect(document.querySelector("iframe")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));

    // The iframe must point at the inline URL: a browser will not render an
    // attachment response, which is what the plain download URL returns.
    const frame = document.querySelector("iframe");
    expect(frame?.getAttribute("src")).toContain("disposition=inline");
    expect(frame?.getAttribute("title")).toBe("report.pdf");
  });

  test("offers the attachment URL for saving, not the inline one", () => {
    renderChip();
    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));

    const download = document.querySelector<HTMLAnchorElement>("a[download]");
    expect(download?.getAttribute("href")).toBe(STORED);
    expect(download?.getAttribute("download")).toBe("report.pdf");
  });

  test("opens on mount only when the run just happened", () => {
    renderChip(pdf, true);
    expect(document.querySelector("iframe")).not.toBeNull();
  });

  test("falls back to a download card for a file it cannot render", () => {
    renderChip(
      {
        filename: "logs.zip",
        url: "/api/storage/download?key=user_1%2Fuuid-logs.zip",
        mimeType: "application/zip",
        sizeBytes: 2048,
      },
      true,
    );

    expect(document.querySelector("iframe")).toBeNull();
    expect(
      screen.getByText(messages.Chat.Artifact.previewUnavailable),
    ).toBeTruthy();
    expect(screen.getAllByText("logs.zip").length).toBeGreaterThan(0);
  });
});

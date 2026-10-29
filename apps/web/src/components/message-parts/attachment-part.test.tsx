// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, test } from "vitest";
import messages from "../../../messages/en.json";
import { ArtifactPanel } from "../artifact-panel/artifact-panel";
import { ArtifactPanelProvider } from "../artifact-panel/artifact-panel-context";
import { AttachmentMessagePart } from "./attachment-part";

const BUCKET = "https://sb.co/storage/v1/object/public/attachments";

type Part = {
  type: "source-url";
  url: string;
  title?: string;
  mediaType?: string;
};

const pdfPart: Part = {
  type: "source-url",
  url: `${BUCKET}/user_1/uuid-report.pdf`,
  title: "report.pdf",
  mediaType: "application/pdf",
};

function renderPart(part: Part, readonly = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ArtifactPanelProvider>
        <AttachmentMessagePart
          part={part}
          isUserMessage
          messageId="msg_1"
          readonly={readonly}
        />
        <ArtifactPanel />
      </ArtifactPanelProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("AttachmentMessagePart", () => {
  test("opens an uploaded PDF in the panel", () => {
    renderPart(pdfPart);

    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));

    const frame = document.querySelector("iframe");
    expect(frame?.getAttribute("src")).toContain("disposition=inline");
    expect(frame?.getAttribute("title")).toBe("report.pdf");
  });

  test("downloads through the app route, never the bucket URL", () => {
    renderPart(pdfPart);
    fireEvent.click(screen.getByRole("button", { name: /report\.pdf/ }));

    const download = document.querySelector<HTMLAnchorElement>("a[download]");
    // The persisted URL is a public-shaped bucket link against a bucket the
    // storage layer treats as private, and the desktop shell hands a foreign
    // host to the system browser. The app route is owner-checked, never
    // expires, and is the one the Save-As handler recognises.
    expect(download?.getAttribute("href")).toBe(
      "/api/storage/download?key=user_1%2Fuuid-report.pdf",
    );
    expect(download?.getAttribute("href")).not.toContain("sb.co");
  });

  test("offers a view for a spreadsheet, which the panel draws as a table", () => {
    renderPart({
      type: "source-url",
      url: `${BUCKET}/user_1/uuid-book.xlsx`,
      title: "book.xlsx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    expect(
      screen.getByText(messages.Chat.Artifact.attachmentOpen),
    ).toBeTruthy();
  });

  test("offers a view for a document, which the panel renders server-side", () => {
    renderPart({
      type: "source-url",
      url: `${BUCKET}/user_1/uuid-notes.docx`,
      title: "notes.docx",
    });

    expect(
      screen.getByText(messages.Chat.Artifact.attachmentOpen),
    ).toBeTruthy();
  });

  test("promises a download, not a view, for a type with no viewer", () => {
    renderPart({
      type: "source-url",
      url: `${BUCKET}/user_1/uuid-logs.zip`,
      title: "logs.zip",
    });

    expect(
      screen.getByText(messages.Chat.Artifact.attachmentDownload),
    ).toBeTruthy();
    expect(
      screen.queryByText(messages.Chat.Artifact.attachmentOpen),
    ).toBeNull();
  });

  test("keeps a link it cannot fetch on the plain card", () => {
    renderPart({
      type: "source-url",
      url: "https://example.test/user_2/secret.pdf",
      title: "secret.pdf",
    });

    // Not our storage object: no panel, and the link is left as it was.
    expect(screen.queryByRole("button")).toBeNull();
    const link = screen.getByRole("link", { name: "secret.pdf" });
    expect(link.getAttribute("href")).toBe(
      "https://example.test/user_2/secret.pdf",
    );
  });

  test("offers nothing it cannot deliver in a shared thread", () => {
    renderPart(pdfPart, true);

    // The viewer is not the owner, so the download route would refuse them
    // and the preview routes with it.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("report.pdf")).toBeTruthy();
    expect(
      screen.getByText(messages.Chat.Artifact.attachmentSharedNotice),
    ).toBeTruthy();
  });
});

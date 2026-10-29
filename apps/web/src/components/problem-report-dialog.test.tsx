// @vitest-environment jsdom

import { appStore } from "@/app/store";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { ProblemReportDialog } from "./problem-report-dialog";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  toggleListening: vi.fn(),
  stopRecording: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/use-presigned-upload", () => ({
  useFileUpload: () => ({ upload: mocks.upload, isUploading: false }),
}));

vi.mock("@/hooks/use-assembly-ai", () => ({
  useAssemblyAI: () => ({
    isListening: false,
    toggleListening: mocks.toggleListening,
    stopRecording: mocks.stopRecording,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ProblemReportDialog />
    </NextIntlClientProvider>,
  );
}

const describeText = () =>
  screen.getByTestId("problem-report-description") as HTMLTextAreaElement;

beforeEach(() => {
  appStore.setState({ openProblemReport: true });
  // jsdom has no object-URL implementation, and the previews rely on it.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:preview");
  globalThis.URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  appStore.setState({ openProblemReport: false });
});

describe("ProblemReportDialog", () => {
  it("renders real copy rather than leaked translation keys", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).not.toMatch(/ProblemReport\.[a-zA-Z.]+/);
    expect(screen.getByText("Report an issue")).toBeTruthy();
  });

  it("keeps submit disabled until the problem is described", () => {
    renderDialog();
    const submit = screen.getByTestId("problem-report-submit");
    expect(submit.hasAttribute("disabled")).toBe(true);

    fireEvent.change(describeText(), { target: { value: "Chat is blank" } });
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("uploads screenshots, posts the report and closes", async () => {
    mocks.upload.mockResolvedValue({
      pathname: "user/1-shot.png",
      url: "https://storage.example.com/shot.png",
      contentType: "image/png",
      size: 11,
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "report-1", traceId: "trace-1" }),
    });

    renderDialog();
    fireEvent.change(describeText(), {
      target: { value: "Voice input dies mid-sentence" },
    });

    const file = new File(["png"], "shot.png", { type: "image/png" });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    fireEvent.click(screen.getByTestId("problem-report-submit"));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/problem-report",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    expect(mocks.upload).toHaveBeenCalledWith(file);

    const body = JSON.parse(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.description).toBe("Voice input dies mid-sentence");
    expect(body.screenshots).toEqual([
      {
        key: "user/1-shot.png",
        url: "https://storage.example.com/shot.png",
        name: "shot.png",
        contentType: "image/png",
        size: 11,
      },
    ]);
    // Context the user would never think to include.
    expect(body.context.pageUrl).toBeTruthy();
    expect(body.context.locale).toBe("en");

    // Closing the dialog is the whole confirmation: 352819bb removed every
    // toast.success in the app because sonner's bottom-right default covered
    // the composer's send button on a phone. Do not assert one here.
    await waitFor(() =>
      expect(appStore.getState().openProblemReport).toBe(false),
    );
  });

  it("keeps the dialog open with the draft intact when the request fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
    });

    renderDialog();
    fireEvent.change(describeText(), { target: { value: "Upload hangs" } });
    fireEvent.click(screen.getByTestId("problem-report-submit"));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(appStore.getState().openProblemReport).toBe(true);
    expect(describeText().value).toBe("Upload hangs");
  });

  it("rejects a non-image attachment instead of sending it", () => {
    renderDialog();
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [new File(["x"], "notes.txt", { type: "text/plain" })],
      },
    });

    expect(mocks.toastError).toHaveBeenCalled();
    expect(globalThis.URL.createObjectURL).not.toHaveBeenCalled();
  });
});

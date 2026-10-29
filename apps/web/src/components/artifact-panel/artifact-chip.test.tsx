// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DefaultToolName } from "lib/ai/tools";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import messages from "../../../messages/en.json";
import { ArtifactChip } from "./artifact-chip";
import { ArtifactPanelProvider } from "./artifact-panel-context";

function sandboxPart(
  state: "input-streaming" | "input-available" = "input-available",
) {
  return {
    type: "tool-E2BSandbox",
    toolCallId: "tool_123",
    state,
    input: {
      template: "nextjs-developer",
      title: "Test app",
      file_path: "pages/index.tsx",
      code: "export default function Home(){return <main>ok</main>}",
      port: 3000,
    },
  } as never;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderChip({
  part = sandboxPart(),
  onResult = vi.fn().mockResolvedValue(undefined),
  chatStatus = "streaming",
  runStatus = "running",
}: {
  part?: ReturnType<typeof sandboxPart>;
  onResult?: (result: unknown) => Promise<void>;
  chatStatus?: string;
  runStatus?:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "timed_out"
    | "cancelled";
} = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ArtifactPanelProvider>
        <ArtifactChip
          part={part}
          toolName={DefaultToolName.E2BSandbox}
          onResult={onResult}
          chatStatus={chatStatus}
          runStatus={runStatus}
        />
      </ArtifactPanelProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ArtifactChip sandbox deployment", () => {
  test("settles interrupted input streaming as failed", async () => {
    renderChip({
      part: sandboxPart("input-streaming"),
      chatStatus: "ready",
      runStatus: "timed_out",
    });

    expect(
      await screen.findByText("Sandbox code generation was interrupted."),
    ).toBeTruthy();
    expect(screen.getByText(/Request tool_123/)).toBeTruthy();
  });

  test("retains a successful preview while awaiting result synchronization", async () => {
    let finishSync: (() => void) | undefined;
    const onResult = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSync = resolve;
        }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          requestId: "6d6fb39f-94af-48f7-b888-5d13ec3a5f0d",
          phase: "ready",
          code: "sandbox_ready",
          retryable: false,
          url: "https://preview.e2b.app",
          sbxId: "sbx_123",
          ready: true,
        }),
      ),
    );

    renderChip({ onResult });

    expect(await screen.findByText("Preview ready")).toBeTruthy();
    expect(onResult).toHaveBeenCalledOnce();
    finishSync?.();
  });

  test("shows a useful error for a non-JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>upstream timeout</html>", {
          status: 504,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    renderChip();

    expect(
      await screen.findByText(
        "Sandbox deployment failed (HTTP 504) with a non-JSON response.",
      ),
    ).toBeTruthy();
  });

  test("fails after the 180-second browser deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      ),
    );

    renderChip();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });

    expect(
      screen.getByText("The browser stopped waiting after 180 seconds."),
    ).toBeTruthy();
  });

  test("offers a deployment retry after a retryable failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            requestId: "6d6fb39f-94af-48f7-b888-5d13ec3a5f0d",
            phase: "failed",
            failedPhase: "starting_sandbox",
            code: "e2b_timeout",
            retryable: true,
            error: "Timed out starting the sandbox.",
          },
          504,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          requestId: "746b3ac6-e1d4-4bf6-90bd-0de410e24e4e",
          phase: "ready",
          code: "sandbox_ready",
          retryable: false,
          url: "https://preview.e2b.app",
          ready: true,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderChip();

    fireEvent.click(await screen.findByRole("button", { name: /retry/i }));

    expect(await screen.findByText("Preview ready")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("preserves success and offers Resume chat when addToolResult rejects", async () => {
    const onResult = vi
      .fn()
      .mockRejectedValueOnce(new Error("chat transport unavailable"))
      .mockResolvedValueOnce(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          requestId: "6d6fb39f-94af-48f7-b888-5d13ec3a5f0d",
          phase: "ready",
          code: "sandbox_ready",
          retryable: false,
          url: "https://preview.e2b.app",
          ready: true,
        }),
      ),
    );
    renderChip({ onResult });

    const resume = await screen.findByRole("button", {
      name: "Resume chat",
    });
    expect(screen.getByText("Preview ready — chat paused")).toBeTruthy();
    fireEvent.click(resume);

    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Resume chat" })).toBeNull(),
    );
    expect(screen.getByText("Preview ready")).toBeTruthy();
  });
});

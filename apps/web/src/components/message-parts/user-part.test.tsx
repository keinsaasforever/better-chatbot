// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import { UserMessagePart } from "./user-part";

const { copy, mentionState } = vi.hoisted(() => ({
  copy: vi.fn(),
  mentionState: {
    agentList: [
      {
        name: "Research Agent",
        icon: { value: "/agent.png", style: { backgroundColor: "red" } },
      },
    ],
    workflowToolList: [
      { name: "Daily Report", icon: { value: "/workflow.png" } },
    ],
  },
}));

vi.mock("@/app/store", () => ({
  appStore: (selector: (state: typeof mentionState) => unknown) =>
    selector(mentionState),
}));
vi.mock("@/hooks/use-copy", () => ({
  useCopy: () => ({ copied: false, copy }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./shared", () => ({
  useDeleteMessage: () => ({ isDeleting: false, deleteMessage: vi.fn() }),
}));
vi.mock("../message-editor", () => ({ MessageEditor: () => null }));

function renderPrompt(text: string) {
  const part = { type: "text" as const, text };
  const message: UIMessage = { id: "message-1", role: "user", parts: [part] };
  return render(
    <UserMessagePart part={part} message={message} isLast readonly />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UserMessagePart mentions", () => {
  test("renders agent, tool and workflow chips inside the actual user bubble", () => {
    const text =
      '@agent("Research Agent")Find papers with @tool(\'web-search\') and @workflow("Daily Report").';
    const { container } = renderPrompt(text);

    expect(screen.getByText("@Research Agent")).toBeTruthy();
    expect(screen.getByText("@web-search")).toBeTruthy();
    expect(screen.getByText("@Daily Report")).toBeTruthy();
    expect(container.querySelectorAll("[data-mention-type]")).toHaveLength(3);
    const content = screen.getByTestId("message-content");
    expect(content.textContent).toContain("Find papers with @web-search and ");
    expect(content.textContent).not.toContain('@agent("');
    expect(content.textContent).not.toContain('@workflow("');
    expect(
      container
        .querySelector('[data-mention-type="agent"] [data-slot="avatar"]')
        ?.getAttribute("style"),
    ).toContain("background-color: red");

    fireEvent.click(screen.getByTestId("message-copy-button"));
    expect(copy).toHaveBeenCalledWith(text);
  });

  test("uses a workflow avatar for the composer's tool-prefixed workflow label", () => {
    const { container } = renderPrompt('@tool("Daily Report")');
    expect(
      container.querySelector(
        '[data-mention-type="tool"] [data-slot="avatar"]',
      ),
    ).toBeTruthy();
  });

  test("keeps unavailable mentions readable, and never interprets HTML in a name", () => {
    const { container } = renderPrompt(
      '@agent("Deleted Agent") @tool("<script>alert(1)</script>")',
    );
    expect(screen.getByText("@Deleted Agent")).toBeTruthy();
    expect(screen.getByText("@<script>alert(1)</script>")).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
  });

  test("preserves plain text and malformed mentions", () => {
    const text = 'Hello\n@agent("unfinished';
    renderPrompt(text);
    expect(screen.getByTestId("message-content").textContent).toBe(text);
  });

  test("keeps chips intact in collapsed messages and copies the complete original", () => {
    const text = "a".repeat(590) + '@agent("Research Agent")' + "b".repeat(100);
    renderPrompt(text);
    expect(screen.getByText("@Research Agent")).toBeTruthy();
    expect(screen.getByTestId("message-content").textContent).not.toContain(
      "b".repeat(100),
    );
    fireEvent.click(screen.getByTestId("message-copy-button"));
    expect(copy).toHaveBeenCalledWith(text);
    fireEvent.click(screen.getByRole("button", { name: "Common.showMore" }));
    expect(screen.getByTestId("message-content").textContent).toContain(
      "b".repeat(100),
    );
    expect(screen.getByText("@Research Agent")).toBeTruthy();
  });
});

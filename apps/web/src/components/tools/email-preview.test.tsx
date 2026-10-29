// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailPreviewUI } from "./email-preview";

const DRAFT = "**Das müsstest du tun:**\n- Zielkunden beschreiben";

// The real English messages, so a key the card asks for but no locale defines
// fails here rather than rendering as a raw key path in the product.
const MESSAGES = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "..", "messages", "en.json"),
    "utf8",
  ),
);

/** Renders inside the intl provider the card needs. */
function renderCard(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("EmailPreviewUI", () => {
  it("renders the draft instead of showing the model's markdown markers", () => {
    renderCard(
      <EmailPreviewUI
        to="anthony@example.com"
        subject="Sales Agent Demo"
        body={DRAFT}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("Das müsstest du tun:").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });

  it("hands every edited field to the caller so the edit is what gets sent", () => {
    const onApprove = vi.fn();
    renderCard(
      <EmailPreviewUI
        to="anthony@example.com"
        subject="Sales Agent Demo"
        body={DRAFT}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "paul@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Neuer Betreff" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "" }), {
      target: { value: "Kurzfassung" },
    });
    fireEvent.click(screen.getByRole("button", { name: /approve & send/i }));

    expect(onApprove).toHaveBeenCalledWith({
      to: "paul@example.com",
      subject: "Neuer Betreff",
      body: "Kurzfassung",
    });
  });

  it("blocks sending while the edited recipient is not a usable address", () => {
    const onApprove = vi.fn();
    renderCard(
      <EmailPreviewUI
        to="anthony@example.com"
        subject="Sales Agent Demo"
        body={DRAFT}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "anthony@" },
    });

    const send = screen.getByRole("button", { name: /approve & send/i });
    expect(send).toHaveProperty("disabled", true);
    fireEvent.click(send);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("shows the header fields read-only until Edit is clicked", () => {
    renderCard(
      <EmailPreviewUI
        to="anthony@example.com"
        subject="Sales Agent Demo"
        body={DRAFT}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("Sales Agent Demo").tagName).toBe("SPAN");
    expect(screen.queryByDisplayValue("Sales Agent Demo")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /edit/i }));

    expect(screen.getByDisplayValue("Sales Agent Demo").tagName).toBe("INPUT");
    expect(screen.getByDisplayValue("anthony@example.com").tagName).toBe(
      "INPUT",
    );
  });

  it("stays read-only once the proposal has settled", () => {
    renderCard(
      <EmailPreviewUI
        to="anthony@example.com"
        subject="Sales Agent Demo"
        body="Moin Anthony"
        outcome="approved"
      />,
    );

    expect(
      screen.getByText(MESSAGES.Chat.Hitl.email.approvedBadge),
    ).not.toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /approve & send/i }),
    ).toBeNull();
  });
});

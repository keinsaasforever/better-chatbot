// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestInputUI } from "./request-input";

const MESSAGES = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "..", "messages", "en.json"),
    "utf8",
  ),
);

function renderCard(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const cadence = {
  header: "Cadence",
  question: "How often should it run?",
  options: [
    { label: "Weekly", description: "Every Monday" },
    { label: "Daily" },
  ],
  multiSelect: false,
  inputType: "text" as const,
};

const sources = {
  header: "Sources",
  question: "Where should it look?",
  options: [],
  multiSelect: false,
  inputType: "text" as const,
};

afterEach(cleanup);

describe("RequestInputUI", () => {
  it("asks every question in one card, so one call needs one submit", () => {
    renderCard(<RequestInputUI questions={[cadence, sources]} />);

    expect(screen.getByText("How often should it run?")).not.toBeNull();
    expect(screen.getByText("Where should it look?")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /submit/i })).toHaveLength(1);
  });

  it("offers options without forcing them: free text still answers", () => {
    const onSubmit = vi.fn();
    renderCard(<RequestInputUI questions={[cadence]} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("How often should it run?"), {
      target: { value: "Every second Tuesday" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith([
      {
        header: "Cadence",
        question: "How often should it run?",
        value: "Every second Tuesday",
      },
    ]);
  });

  it("fills the field from a picked option", () => {
    const onSubmit = vi.fn();
    renderCard(<RequestInputUI questions={[cadence]} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /Weekly/ }));
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({ value: "Weekly" }),
    ]);
  });

  it("lets typing override a picked option instead of appending to it", () => {
    const onSubmit = vi.fn();
    renderCard(<RequestInputUI questions={[cadence]} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /Weekly/ }));
    fireEvent.change(screen.getByLabelText("How often should it run?"), {
      target: { value: "Monthly" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith([
      expect.objectContaining({ value: "Monthly" }),
    ]);
  });

  it("blocks submit until every question is answered", () => {
    const onSubmit = vi.fn();
    renderCard(
      <RequestInputUI questions={[cadence, sources]} onSubmit={onSubmit} />,
    );

    const submit = screen.getByRole("button", { name: /submit/i });
    expect(submit).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: /Weekly/ }));
    expect(submit).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Where should it look?"), {
      target: { value: "LinkedIn" },
    });
    expect(submit).toHaveProperty("disabled", false);
  });

  it("stays read-only once answered, and masks a secret", () => {
    renderCard(
      <RequestInputUI
        questions={[{ ...sources, inputType: "password" }]}
        submittedAnswers={[
          {
            header: "Sources",
            question: "Where should it look?",
            value: "sk-secret",
          },
        ]}
      />,
    );

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /submit/i })).toBeNull();
    expect(screen.queryByText("sk-secret")).toBeNull();
    expect(screen.getByText("••••••••")).not.toBeNull();
  });

  it("renders nothing when there is no question to ask", () => {
    const { container } = renderCard(<RequestInputUI questions={[]} />);
    expect(container.textContent).toBe("");
  });
});

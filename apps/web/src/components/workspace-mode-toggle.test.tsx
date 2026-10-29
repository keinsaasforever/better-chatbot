// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, prefetch: _p, ...props }: any) => (
    <a href={href} {...props} />
  ),
}));

const { WorkspaceModeToggle, workspaceModeOf } = await import(
  "./workspace-mode-toggle"
);

function renderAt(pathname: string) {
  nav.pathname = pathname;
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <WorkspaceModeToggle />
    </NextIntlClientProvider>,
  );
}

describe("WorkspaceModeToggle", () => {
  afterEach(cleanup);

  it("marks Work active on the home screen", () => {
    renderAt("/");
    const work = screen.getByRole("tab", { name: "Work" });
    expect(work.getAttribute("aria-selected")).toBe("true");
    expect(work.getAttribute("href")).toBe("/");
    expect(
      screen
        .getByRole("tab", { name: "Cockpit" })
        .getAttribute("aria-selected"),
    ).toBe("false");
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe(
      "Workspace mode",
    );
  });

  it("marks Cockpit active on /cockpit and links back to Work", () => {
    renderAt("/cockpit");
    const cockpit = screen.getByRole("tab", { name: "Cockpit" });
    expect(cockpit.getAttribute("aria-selected")).toBe("true");
    expect(cockpit.getAttribute("href")).toBe("/cockpit");
    expect(cockpit.getAttribute("aria-current")).toBe("page");
  });

  it("treats only /cockpit and its children as Cockpit", () => {
    expect(workspaceModeOf("/cockpit/anything")).toBe("cockpit");
    expect(workspaceModeOf("/cockpitx")).toBe("work");
    expect(workspaceModeOf("/chat/123")).toBe("work");
    expect(workspaceModeOf(null)).toBe("work");
  });
});

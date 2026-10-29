// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { CockpitUpdates } = await import("./cockpit-updates");
const { COCKPIT_UPDATE_EVENT, announceCockpitPushUpdate } = await import(
  "@/hooks/queries/use-cockpit-updates"
);

const serverRows = [
  {
    id: "n1",
    userId: "u",
    type: "cockpit_update.alert",
    title: "Deploy failed: NAVIGATOR",
    body: "The latest NAVIGATOR deployment on Vercel ended in ERROR.",
    url: "/cockpit",
    threadId: null,
    agentId: null,
    dedupeKey: "vercel:dpl_1",
    readAt: null,
    createdAt: "2026-10-07T10:00:00.000Z",
  },
];

function renderWidget() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <CockpitUpdates />
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}

describe("CockpitUpdates", () => {
  let rows: typeof serverRows;
  beforeEach(() => {
    rows = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(String(url)).toContain(
          "type=cockpit_update,cockpit_update.warn,cockpit_update.alert",
        );
        return new Response(
          JSON.stringify({ notifications: rows, unreadCount: rows.length }),
          { headers: { "Content-Type": "application/json" } },
        );
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the empty state when there are no updates", async () => {
    renderWidget();
    expect(await screen.findByText("No updates yet")).toBeTruthy();
  });

  it("shows the stored title with the severity from the type suffix", async () => {
    rows = serverRows;
    renderWidget();
    expect(await screen.findByText("Deploy failed: NAVIGATOR")).toBeTruthy();
    expect(screen.getByLabelText("Alert")).toBeTruthy();
    expect(
      screen.getByTitle(
        "Deploy failed: NAVIGATOR · The latest NAVIGATOR deployment on Vercel ended in ERROR.",
      ),
    ).toBeTruthy();
  });

  it("treats an unknown suffix as info", async () => {
    rows = [{ ...serverRows[0], id: "n2", type: "cockpit_update" }];
    renderWidget();
    await screen.findByText("Deploy failed: NAVIGATOR");
    expect(screen.getByLabelText("Info")).toBeTruthy();
  });

  it("prepends a cockpit:update event before the next poll", async () => {
    renderWidget();
    await screen.findByText("No updates yet");
    // The tool persisted the row before the event fired; the poll returns it.
    rows = [
      {
        ...serverRows[0],
        id: "n3",
        type: "cockpit_update.warn",
        title: "Created chat for the sales agent",
        body: null as never,
      },
    ];
    act(() => {
      window.dispatchEvent(
        new CustomEvent(COCKPIT_UPDATE_EVENT, {
          detail: {
            title: "Created chat for the sales agent",
            severity: "warn",
          },
        }),
      );
    });
    expect(
      await screen.findByText("Created chat for the sales agent"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Warning")).toBeTruthy();
  });

  it("announces a posted cockpit_push_update from the voice session", async () => {
    renderWidget();
    await screen.findByText("No updates yet");
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(COCKPIT_UPDATE_EVENT, listener);
    rows = [
      {
        ...serverRows[0],
        id: "n9",
        type: "cockpit_update.alert",
        title: "Checkout is failing",
        body: null as never,
      },
    ];
    act(() => {
      // Replays and other tools stay silent.
      announceCockpitPushUpdate(
        "cockpit_push_update",
        { title: "Checkout is failing" },
        { posted: false, duplicate: true, severity: "alert" },
      );
      announceCockpitPushUpdate(
        "list_agents",
        { title: "x" },
        { posted: true },
      );
      announceCockpitPushUpdate(
        "cockpit_push_update",
        { title: "Checkout is failing", severity: "alert" },
        { posted: true, id: "n9", severity: "alert" },
      );
    });
    window.removeEventListener(COCKPIT_UPDATE_EVENT, listener);
    expect(seen).toEqual([
      {
        id: "n9",
        title: "Checkout is failing",
        body: null,
        severity: "alert",
        url: null,
      },
    ]);
    expect(await screen.findByText("Checkout is failing")).toBeTruthy();
    expect(screen.getByLabelText("Alert")).toBeTruthy();
  });
});

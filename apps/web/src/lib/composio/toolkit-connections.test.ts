import { describe, expect, it } from "vitest";
import {
  mapToolkitsWithAccounts,
  resolveComposioAccount,
} from "./toolkit-connections";

const toolkit = (overrides: Record<string, unknown> = {}) => ({
  slug: "gmail",
  name: "Gmail",
  logo: "https://logo",
  isNoAuth: false,
  connection: undefined,
  ...overrides,
});

describe("mapToolkitsWithAccounts", () => {
  it("marks a toolkit connected via the toolkit connection flag", () => {
    const [mapped] = mapToolkitsWithAccounts([
      toolkit({
        connection: { isActive: true, connectedAccount: { id: "ca_1" } },
      }),
    ]);
    expect(mapped.isConnected).toBe(true);
    expect(mapped.connectedAccountId).toBe("ca_1");
  });

  it("reconciles a lagging toolkit flag against the active-accounts map", () => {
    // The under-count bug: account exists but session.toolkits() reports no
    // active connection — the toolkit must still show as connected.
    const [mapped] = mapToolkitsWithAccounts(
      [toolkit()],
      undefined,
      new Map([["gmail", "ca_fallback"]]),
    );
    expect(mapped.isConnected).toBe(true);
    expect(mapped.connectedAccountId).toBe("ca_fallback");
  });

  it("prefers the toolkit connection's account id over the fallback", () => {
    const [mapped] = mapToolkitsWithAccounts(
      [
        toolkit({
          connection: { isActive: true, connectedAccount: { id: "ca_flag" } },
        }),
      ],
      undefined,
      new Map([["gmail", "ca_fallback"]]),
    );
    expect(mapped.connectedAccountId).toBe("ca_flag");
  });

  it("drops no-auth toolkits unless an account exists for them", () => {
    const mapped = mapToolkitsWithAccounts(
      [
        toolkit({ slug: "composio_search", name: "Search", isNoAuth: true }),
        toolkit({ slug: "hackernews", name: "HN", isNoAuth: true }),
      ],
      undefined,
      new Map([["hackernews", "ca_hn"]]),
    );
    expect(mapped.map((t) => t.slug)).toEqual(["hackernews"]);
  });

  it("emits a toolkit the listing never returned but an account exists for", () => {
    // The disappearing-app bug: the reconcile could only enrich a toolkit the
    // listing already handed back, so a connected app missing from `items`
    // vanished from the UI entirely.
    const mapped = mapToolkitsWithAccounts(
      [toolkit()],
      undefined,
      new Map([
        ["gmail", "ca_gmail"],
        ["google_sheets", "ca_sheets"],
      ]),
    );

    const sheets = mapped.find((t) => t.slug === "google_sheets");
    expect(sheets).toMatchObject({
      isConnected: true,
      connectedAccountId: "ca_sheets",
      // Only the slug is known for a toolkit the listing skipped.
      name: "Google Sheets",
    });
  });

  it("does not duplicate a toolkit the listing did return", () => {
    const mapped = mapToolkitsWithAccounts(
      [toolkit()],
      undefined,
      new Map([["gmail", "ca_gmail"]]),
    );
    expect(mapped.filter((t) => t.slug === "gmail")).toHaveLength(1);
  });

  it("omits unlisted connections when asked to, for pages after the first", () => {
    const mapped = mapToolkitsWithAccounts(
      [toolkit()],
      undefined,
      new Map([["google_sheets", "ca_sheets"]]),
      { includeUnlisted: false },
    );
    expect(mapped.map((t) => t.slug)).toEqual(["gmail"]);
  });
});

describe("resolveComposioAccount", () => {
  const account = (
    id: string,
    createdAt: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    createdAt,
    isDisabled: false,
    toolkit: { slug: "gmail" },
    ...overrides,
  });

  const items = [
    account("ca_old", "2026-01-01T00:00:00Z"),
    account("ca_new", "2026-07-01T00:00:00Z"),
    account("ca_disabled", "2026-07-10T00:00:00Z", { isDisabled: true }),
    account("ca_other", "2026-07-15T00:00:00Z", {
      toolkit: { slug: "slack" },
    }),
  ];

  it("matches the exact account when a connectionRef is given", () => {
    expect(resolveComposioAccount(items, "gmail", "ca_old")?.id).toBe("ca_old");
  });

  it("returns undefined for an unknown connectionRef", () => {
    expect(resolveComposioAccount(items, "gmail", "ca_missing")).toBe(
      undefined,
    );
  });

  it("falls back to the newest active account for the toolkit", () => {
    // Post-OAuth attach without a known account id must not fail
    // (the old invalid_connector bug) — the newest active account wins.
    expect(resolveComposioAccount(items, "gmail")?.id).toBe("ca_new");
  });

  it("never picks disabled or other-toolkit accounts", () => {
    expect(
      resolveComposioAccount(
        [
          items[2] as (typeof items)[number],
          items[3] as (typeof items)[number],
        ],
        "gmail",
      ),
    ).toBe(undefined);
  });
});

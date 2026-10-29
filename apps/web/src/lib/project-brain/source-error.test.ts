import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  ProjectSourceError,
  connectorStatusForSourceError,
  isPermanentSourceError,
  resolveSourceError,
} = await import("./run-source");

describe("source error classification", () => {
  test("a revoked connector is permanent — retrying only burns the budget", () => {
    const error = new ProjectSourceError(
      "connection_not_active",
      "The connector's bound account is no longer active.",
    );

    expect(isPermanentSourceError(error)).toBe(true);
  });

  test("transient failures stay retriable", () => {
    expect(
      isPermanentSourceError(
        new ProjectSourceError("no_data_returned", "empty"),
      ),
    ).toBe(false);
    expect(
      isPermanentSourceError(new ProjectSourceError("source_failed", "boom")),
    ).toBe(false);
    expect(isPermanentSourceError(new Error("network blip"))).toBe(false);
  });

  test("unwraps a source error carried as another error's cause", () => {
    const cause = new ProjectSourceError("connection_not_active", "gone");
    const wrapper = new Error("wrapped", { cause });

    expect(resolveSourceError(wrapper)).toBe(cause);
    expect(isPermanentSourceError(wrapper)).toBe(true);
  });

  test("returns null when there is no source error to unwrap", () => {
    expect(resolveSourceError(new Error("plain"))).toBeNull();
    expect(resolveSourceError(null)).toBeNull();
    expect(resolveSourceError(undefined)).toBeNull();
  });

  test("maps codes onto the connector status the UI acts on", () => {
    expect(connectorStatusForSourceError("connection_not_active")).toBe(
      "needs_auth",
    );
    expect(connectorStatusForSourceError("credential_owner_removed")).toBe(
      "needs_auth",
    );
    expect(connectorStatusForSourceError("no_read_actions")).toBe("error");
    // Says nothing about the connector's health — leave it connected.
    expect(connectorStatusForSourceError("no_data_returned")).toBeNull();
    expect(connectorStatusForSourceError("source_failed")).toBeNull();
  });
});

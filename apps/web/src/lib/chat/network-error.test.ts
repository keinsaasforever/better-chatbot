import { describe, expect, it } from "vitest";
import { isNetworkError } from "./network-error";

describe("isNetworkError", () => {
  it("classifies a WebKit fetch teardown as a network error", () => {
    // What iOS Safari throws when it freezes a backgrounded tab mid-stream.
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
  });

  it("classifies the other browsers' wordings and aborts too", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(
      isNetworkError(
        new TypeError("NetworkError when attempting to fetch resource."),
      ),
    ).toBe(true);
    expect(isNetworkError(new Error("The network connection was lost."))).toBe(
      true,
    );
    const aborted = new Error("signal is aborted without reason");
    aborted.name = "AbortError";
    expect(isNetworkError(aborted)).toBe(true);
  });

  it("leaves genuine server errors alone", () => {
    expect(isNetworkError(new Error("Rate limit exceeded"))).toBe(false);
    // Mentions fetching, but it is a real server/tool failure with detail the
    // user needs to see.
    expect(isNetworkError(new Error("Failed to fetch the document"))).toBe(
      false,
    );
  });

  it("does not throw on non-error values", () => {
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError("Load failed")).toBe(false);
    expect(isNetworkError({ name: "TypeError" })).toBe(false);
  });
});

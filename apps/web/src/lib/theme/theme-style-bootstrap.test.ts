// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";
import { THEME_STYLE_BOOTSTRAP_SCRIPT } from "./theme-style-bootstrap";

function runBootstrap() {
  // eslint-disable-next-line no-new-func
  new Function(THEME_STYLE_BOOTSTRAP_SCRIPT)();
}

afterEach(() => {
  localStorage.clear();
  document.body.removeAttribute("data-theme");
  vi.restoreAllMocks();
});

describe("THEME_STYLE_BOOTSTRAP_SCRIPT", () => {
  test("applies the stored palette before paint", () => {
    localStorage.setItem(
      "CHATBOT-STORAGE-theme-style",
      JSON.stringify({ value: "cyberpunk-neon" }),
    );

    runBootstrap();

    expect(document.body.getAttribute("data-theme")).toBe("cyberpunk-neon");
  });

  test("reads the legacy misspelled prefix", () => {
    localStorage.setItem(
      "ChATBOT-STOREAGE-theme-style",
      JSON.stringify({ value: "zinc" }),
    );

    runBootstrap();

    expect(document.body.getAttribute("data-theme")).toBe("zinc");
  });

  test("falls back to the default palette when nothing is stored", () => {
    runBootstrap();

    expect(document.body.getAttribute("data-theme")).toBe("default");
  });

  test("falls back to the default palette when localStorage throws", () => {
    // Safari private mode and cookie-blocking extensions make this throw. The
    // script must still set an attribute rather than break the document.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });

    expect(() => runBootstrap()).not.toThrow();
    expect(document.body.getAttribute("data-theme")).toBe("default");
  });
});

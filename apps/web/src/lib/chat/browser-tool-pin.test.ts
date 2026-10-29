import { AppDefaultToolkit, DefaultToolName } from "lib/ai/tools";
import { describe, expect, it } from "vitest";
import { isBrowserToolkitOn } from "./browser-tool-pin";

const pin = (name: string) =>
  [{ type: "defaultTool", name }] as Parameters<
    typeof isBrowserToolkitOn
  >[0]["mentions"];

describe("isBrowserToolkitOn", () => {
  it("is on when the toolkit is in the client's list", () => {
    expect(
      isBrowserToolkitOn({
        allowedAppDefaultToolkit: [
          AppDefaultToolkit.Code,
          AppDefaultToolkit.BrowserAutomation,
        ],
      }),
    ).toBe(true);
  });

  it("is off when the client's list omits it", () => {
    expect(
      isBrowserToolkitOn({
        allowedAppDefaultToolkit: [AppDefaultToolkit.Code],
      }),
    ).toBe(false);
  });

  // The regression: pinning the tool empties the client's toolkit list, so
  // without honouring the pin, naming the tool is what removes it.
  it("is on when the browser tool is pinned, despite the empty list a pin sends", () => {
    expect(
      isBrowserToolkitOn({
        mentions: pin(DefaultToolName.BrowserAutomation),
        allowedAppDefaultToolkit: [],
      }),
    ).toBe(true);
  });

  it("stays off when a different default tool is pinned", () => {
    expect(
      isBrowserToolkitOn({
        mentions: pin(DefaultToolName.PythonExecution),
        allowedAppDefaultToolkit: [],
      }),
    ).toBe(false);
  });

  // No list at all means "everything the user has not switched off".
  it("defaults on when the client sends no list", () => {
    expect(isBrowserToolkitOn({})).toBe(true);
  });
});

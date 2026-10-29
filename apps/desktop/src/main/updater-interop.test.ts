import { describe, expect, it } from "vitest";
import { resolveAutoUpdater } from "./updater-interop";

describe("resolveAutoUpdater", () => {
  it("reads autoUpdater off the namespace when the lexer found it", () => {
    const updater = { name: "detected" };
    expect(resolveAutoUpdater({ autoUpdater: updater })).toBe(updater);
  });

  it("falls back to module.exports, which is the shape electron-updater ships", () => {
    // What `import("electron-updater")` actually produces: the getter-defined
    // `autoUpdater` is missing from the namespace and only reachable via default.
    const updater = { name: "from module.exports" };
    const namespace = {
      NsisUpdater: class {},
      AppUpdater: class {},
      default: { autoUpdater: updater },
    };
    expect(resolveAutoUpdater(namespace)).toBe(updater);
  });

  it("throws a diagnosable error when neither shape carries an updater", () => {
    expect(() => resolveAutoUpdater({ NsisUpdater: class {} })).toThrow(
      /exposed no autoUpdater/,
    );
    expect(() => resolveAutoUpdater(undefined)).toThrow(
      /exposed no autoUpdater/,
    );
  });
});

/**
 * Reaching electron-updater's `autoUpdater` from an ES module.
 *
 * The main process is bundled as ESM, and electron-updater stays external and
 * CommonJS. Node builds the namespace for a CJS module from the named exports
 * cjs-module-lexer can find by reading the source, and electron-updater
 * defines its most important one as
 *
 *   Object.defineProperty(exports, "autoUpdater", { get: () => ... })
 *
 * whose getter body is not a plain re-export, so the lexer skips it and
 * `import("electron-updater")` hands back a namespace with no `autoUpdater`.
 * Destructuring it yields `undefined` and the first property write throws.
 * `default` always carries the real `module.exports`, where reading the
 * property runs the getter.
 *
 * Pure module: no `electron` import, so it is unit-testable.
 */

/** The parts of the module this shim touches; the real type needs electron. */
type UpdaterNamespace = {
  autoUpdater?: unknown;
  default?: { autoUpdater?: unknown };
};

export function resolveAutoUpdater<T>(namespace: unknown): T {
  const candidate = namespace as UpdaterNamespace | null;
  const resolved = candidate?.autoUpdater ?? candidate?.default?.autoUpdater;
  if (resolved == null) {
    throw new Error(
      "electron-updater loaded but exposed no autoUpdater; the packaged build cannot update itself",
    );
  }
  return resolved as T;
}

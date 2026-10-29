import { type DependencyList, useEffect } from "react";

/** Window-level keydown listener for the effect's lifetime. The handler
 * decides which shortcuts it cares about; this owns the listener boilerplate
 * hand-rolled in each chat variant. */
export function useGlobalShortcut(
  handler: (e: KeyboardEvent) => void,
  deps: DependencyList,
) {
  useEffect(() => {
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

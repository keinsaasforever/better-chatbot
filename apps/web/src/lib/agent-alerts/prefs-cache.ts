import type { ResolvedNotificationPrefs } from "./types";
import { resolveNotificationPrefs } from "./resolve-notification-prefs";

let cachedPrefs: ResolvedNotificationPrefs = resolveNotificationPrefs();

export function getCachedNotificationPrefs(): ResolvedNotificationPrefs {
  return cachedPrefs;
}

export function setCachedNotificationPrefs(
  prefs?: ResolvedNotificationPrefs,
): void {
  cachedPrefs = prefs ?? resolveNotificationPrefs();
}

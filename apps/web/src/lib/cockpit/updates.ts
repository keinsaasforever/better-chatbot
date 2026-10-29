/**
 * Cockpit UPDATES rows are ordinary in-app notifications. The severity rides
 * on the notification `type` as a suffix rather than inside `body`, because
 * the header bell renders `body` verbatim and a JSON blob there would be
 * unreadable: `title` and `body` stay plain readable text. Plain
 * `cockpit_update` is info, so rows written before severities existed keep
 * their meaning.
 *
 * Client-safe: the cockpit widget parses these too.
 */
export const COCKPIT_UPDATE_TYPE = "cockpit_update";

export const COCKPIT_UPDATE_SEVERITIES = ["info", "warn", "alert"] as const;

export type CockpitUpdateSeverity = (typeof COCKPIT_UPDATE_SEVERITIES)[number];

export const COCKPIT_UPDATE_TYPES = [
  COCKPIT_UPDATE_TYPE,
  `${COCKPIT_UPDATE_TYPE}.warn`,
  `${COCKPIT_UPDATE_TYPE}.alert`,
] as const;

export function cockpitUpdateType(severity: CockpitUpdateSeverity): string {
  return severity === "info"
    ? COCKPIT_UPDATE_TYPE
    : `${COCKPIT_UPDATE_TYPE}.${severity}`;
}

export function parseCockpitUpdateSeverity(
  type: string,
): CockpitUpdateSeverity | null {
  if (type === COCKPIT_UPDATE_TYPE) return "info";
  if (type === `${COCKPIT_UPDATE_TYPE}.warn`) return "warn";
  if (type === `${COCKPIT_UPDATE_TYPE}.alert`) return "alert";
  return null;
}

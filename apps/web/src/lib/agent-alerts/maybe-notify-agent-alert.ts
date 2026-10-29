"use client";

import { showAgentAlertToast } from "@/components/agent-alerts/agent-alert-toast";
import {
  buildAgentAlertCopy,
  getAgentAlertToastId,
  getChatPath,
} from "@/lib/agent-alerts/copy";
import { getCachedNotificationPrefs } from "@/lib/agent-alerts/prefs-cache";
import type { AgentAlertPayload } from "@/lib/agent-alerts/types";
import {
  isAppAway,
  shouldForceAwayNotification,
} from "@/lib/agent-alerts/visibility";
import { isDesktop } from "@keinsaas/mcp-core/is-desktop";

let hasPushSubscription = false;

export function setHasPushSubscription(value: boolean): void {
  hasPushSubscription = value;
}

export function getHasPushSubscription(): boolean {
  return hasPushSubscription;
}

const notifiedKeys = new Set<string>();

function getDedupKey(payload: AgentAlertPayload): string {
  return getAgentAlertToastId(payload.threadId, payload.kind);
}

function navigateToPath(path: string): void {
  if (typeof window === "undefined") return;
  window.focus();
  window.location.assign(path);
}

function navigateToThread(threadId?: string): void {
  navigateToPath(getChatPath(threadId));
}

/**
 * True when the user is currently looking at this very thread in the
 * foreground. In that case there is nothing to alert them about — the result
 * is already on screen. We gate on the concrete "page is visible and shows
 * this thread" signal rather than the focus-based away heuristic, because
 * `document.hasFocus()` is unreliable on mobile browsers (it frequently
 * reports `false` while the page is plainly visible), which caused the
 * completion toast to pop while the user was actively reading the reply.
 */
function isViewingThread(threadId?: string): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  if (document.hidden) return false;
  return window.location.pathname === getChatPath(threadId);
}

function showBrowserOsNotification(
  payload: AgentAlertPayload,
  prefs: ReturnType<typeof getCachedNotificationPrefs>,
): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const away = isAppAway() || shouldForceAwayNotification();
  if (prefs.onlyWhenAway && !away) return;

  // Server Web Push handles away/closed delivery for completions when subscribed.
  if (payload.kind === "complete" && getHasPushSubscription()) return;

  const key = getDedupKey(payload);
  if (notifiedKeys.has(key)) return;
  notifiedKeys.add(key);

  const copy = buildAgentAlertCopy(payload, prefs);
  const notification = new Notification(copy.title, {
    body: copy.body,
    tag: key,
    icon: "/favicon.ico",
  });

  notification.onclick = () => {
    notification.close();
    navigateToThread(payload.threadId);
  };
}

export function maybeNotifyAgentAlert(payload: AgentAlertPayload): void {
  if (typeof window === "undefined") return;

  const prefs = getCachedNotificationPrefs();
  if (!prefs.desktopEnabled) return;

  // Don't alert about a thread the user is already looking at.
  if (isViewingThread(payload.threadId)) return;

  const away = isAppAway() || shouldForceAwayNotification();
  const showWidget = !prefs.onlyWhenAway || !away;

  if (showWidget) {
    showAgentAlertToast(payload, prefs, navigateToPath);
    return;
  }

  if (isDesktop) {
    const copy = buildAgentAlertCopy(payload, prefs);
    void window.desktop?.notifications?.show({
      kind: payload.kind,
      threadId: payload.threadId,
      title: copy.title,
      body: copy.body,
      url: getChatPath(payload.threadId),
      onlyWhenAway: prefs.onlyWhenAway,
    });
    return;
  }

  showBrowserOsNotification(payload, prefs);
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  if (Notification.permission !== "default") {
    return Notification.permission;
  }
  return Notification.requestPermission();
}

export function sendTestAgentAlert(): void {
  maybeNotifyAgentAlert({
    kind: "complete",
    threadId: undefined,
    title: "Test notification",
  });
}

export function clearAgentAlertDedup(): void {
  notifiedKeys.clear();
}

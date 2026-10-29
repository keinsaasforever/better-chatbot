import { Notification } from "electron";
import type { BrowserWindow } from "electron";
import { resolveAppIconPath } from "./icon.js";

export type DesktopAgentAlertPayload = {
  kind: "complete" | "needs_approval" | "needs_input" | "error";
  threadId?: string;
  title: string;
  body: string;
  url?: string;
  onlyWhenAway?: boolean;
};

let mainWindow: BrowserWindow | null = null;

export function setNotificationMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export function showDesktopAgentNotification(
  payload: DesktopAgentAlertPayload,
): void {
  if (payload.onlyWhenAway !== false && mainWindow) {
    const focused = mainWindow.isFocused();
    const minimized = mainWindow.isMinimized();
    if (focused && !minimized) {
      return;
    }
  }

  const icon = resolveAppIconPath();
  const notification = new Notification({
    title: payload.title,
    body: payload.body,
    ...(icon ? { icon } : {}),
    silent: false,
  });

  notification.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    const path =
      payload.url ?? (payload.threadId ? `/chat/${payload.threadId}` : "/");
    void mainWindow.webContents.executeJavaScript(
      `window.location.assign(${JSON.stringify(path)})`,
      true,
    );
  });
}

import { ipcMain } from "electron";
import {
  setNotificationMainWindow,
  showDesktopAgentNotification,
  type DesktopAgentAlertPayload,
} from "./notifications.js";

export function registerNotificationHandlers(): void {
  ipcMain.handle(
    "notifications:show",
    (_event, payload: DesktopAgentAlertPayload) => {
      showDesktopAgentNotification(payload);
    },
  );

  ipcMain.handle("notifications:get-permission", () => "granted");

  ipcMain.handle("notifications:request-permission", () => "granted");
}

export { setNotificationMainWindow };

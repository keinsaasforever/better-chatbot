import { app, ipcMain } from "electron";

/**
 * IPC handlers for desktop-native capabilities.
 * MCP stdio spawning and filesystem access land in Phase 6.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle("desktop:get-platform", () => process.platform);

  ipcMain.handle("desktop:get-version", () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
  }));
}

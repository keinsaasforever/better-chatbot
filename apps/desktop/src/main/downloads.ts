import path from "node:path";
import { Notification, app, shell } from "electron";
import type { DownloadItem, Session } from "electron";
import {
  type DownloadNotificationState,
  defaultSavePath,
  describeDownloadUrl,
  downloadNotificationText,
  sanitizeDownloadFilename,
} from "./download-paths.js";
import { isAppDownloadUrl } from "./external-links.js";
import { resolveAppIconPath } from "./icon.js";
import { recordDesktopError } from "./otel.js";

/**
 * File downloads in the desktop shell.
 *
 * Without this, Electron applied its defaults to every download the web app
 * started: a generated Excel file clicked in the chat opened a blank window and
 * the user never saw a save dialog they could trust. Every download now gets
 * the native Save As dialog, starting in the OS Downloads folder, and a
 * notification that reveals the saved file.
 *
 * Downloads reach this handler three ways: an `<a download>` click (never a
 * navigation, so straight to `will-download`), a `window.open` of a download
 * route (`setWindowOpenHandler` in ./index.ts calls `downloadURL`), and a
 * top-level navigation to one (`will-navigate`, same).
 */
export function registerDownloadHandler(
  targetSession: Session,
  appOrigin: string,
): void {
  targetSession.on("will-download", (_event, item) => {
    const url = item.getURL();
    const label = describeDownloadUrl(url);
    const filename = sanitizeDownloadFilename(item.getFilename());

    // The app route answers JSON (401 without a session, 404 for a missing
    // object). Saving that as `download.json` would look like success.
    if (
      item.getMimeType() === "application/json" &&
      isAppDownloadUrl(url, appOrigin)
    ) {
      item.cancel();
      recordDesktopError(
        "desktop.download",
        new Error("download route answered with JSON"),
        { "download.url": label },
      );
      notify(filename, "failed");
      return;
    }

    // Save As dialog on purpose (no `setSavePath`, which would skip it).
    item.setSaveDialogOptions({
      defaultPath: defaultSavePath(app.getPath("downloads"), filename),
    });
    console.log(`[desktop] download ${label}`);

    item.once("done", (_doneEvent, state) => onDone(item, state, label));
  });
}

function onDone(
  item: DownloadItem,
  state: "completed" | "cancelled" | "interrupted",
  label: string,
): void {
  const savePath = item.getSavePath();
  const filename = path.basename(savePath) || item.getFilename();

  if (state === "completed") {
    console.log(`[desktop] download saved ${savePath}`);
    if (process.platform === "darwin" && app.dock) {
      app.dock.downloadFinished(savePath);
    }
    notify(filename, "completed", savePath);
    return;
  }

  if (state === "interrupted") {
    recordDesktopError("desktop.download", new Error(`download ${state}`), {
      "download.url": label,
    });
    notify(filename, "failed");
  }
  // "cancelled": the user closed the dialog. Nothing to report.
}

function notify(
  filename: string,
  state: DownloadNotificationState,
  savePath?: string,
): void {
  if (!Notification.isSupported()) return;
  const { title, body } = downloadNotificationText(
    app.getLocale(),
    filename,
    state,
  );
  const icon = resolveAppIconPath();
  const notification = new Notification({
    title,
    body,
    ...(icon ? { icon } : {}),
  });
  if (savePath) {
    notification.on("click", () => shell.showItemInFolder(savePath));
  }
  notification.show();
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserWindow, app, dialog, ipcMain } from "electron";
import type { AppUpdater, ProgressInfo, UpdateInfo } from "electron-updater";
import { recordDesktopError } from "./otel.js";
import {
  AUTO_CHECK_INTERVAL_MS,
  FOCUS_CHECK_MIN_GAP_MS,
  type UpdateCheckSource,
  isForcedCheck,
  shouldRunAutoCheck,
} from "./update-policy.js";
import { resolveAutoUpdater } from "./updater-interop.js";
import { type UpdaterLogger, createUpdaterLogger } from "./updater-log.js";

export type DesktopUpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "not-available" }
  | { status: "downloading"; version: string; percent: number }
  | { status: "downloaded"; version: string }
  | { status: "error"; message: string };

const UPDATE_STATE_CHANGED_CHANNEL = "updates:state-changed";
const OPERATION = "desktop.updater";

let updateState: DesktopUpdateState = { status: "idle" };
let mainWindow: BrowserWindow | null = null;
let autoUpdaterRef: AppUpdater | null = null;
let logger: UpdaterLogger | null = null;
let lastCheckAt: number | null = null;
let checkInFlight = false;
let disabledReason: string | null = null;

function log(): UpdaterLogger {
  if (!logger) logger = createUpdaterLogger();
  return logger;
}

function setState(next: DesktopUpdateState): void {
  updateState = next;
  mainWindow?.webContents.send(UPDATE_STATE_CHANGED_CHANNEL, updateState);
}

export function setUpdateMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

/**
 * Resolves the update feed, or null when this build has none.
 *
 * `DESKTOP_UPDATE_FEED_URL` wins at runtime; otherwise the feed baked in by
 * electron-builder at package time is used. Builds packaged without the env
 * var carry an empty publish URL, which is how community builds ship with
 * auto-update switched off.
 */
function resolveUpdateFeedUrl(): string | null {
  const fromEnv = process.env.DESKTOP_UPDATE_FEED_URL?.trim();
  if (fromEnv) return fromEnv;

  try {
    const packagedConfig = join(process.resourcesPath, "app-update.yml");
    if (!existsSync(packagedConfig)) return null;
    const url = readFileSync(packagedConfig, "utf8").match(
      /^\s*url:\s*(\S+)\s*$/m,
    )?.[1];
    return url && url !== '""' && url !== "''" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Auto-update wiring.
 *
 * Behaves like most desktop apps: checks at startup, on window focus
 * (throttled) and hourly; downloads a new version in the background; asks the
 * user to restart via the web UI toast; installs on quit if they never do.
 * Everything is written to the updater log and errors go to desktop
 * telemetry, because a silent updater is what left 1.25.0 clients stranded.
 */
export function initAutoUpdater(): void {
  const l = log();
  l.info(
    `app ${app.getVersion()} electron ${process.versions.electron} platform ${process.platform}`,
  );

  if (!app.isPackaged) {
    disabledReason = "development build";
    l.info("updater disabled: development build");
    return;
  }

  const feedUrl = resolveUpdateFeedUrl();
  if (!feedUrl) {
    disabledReason = "this build has no update feed";
    l.warn("updater disabled: no update feed configured in this build");
    return;
  }
  l.info(`update feed ${feedUrl}`);

  void import("electron-updater")
    .then((updaterModule) => {
      const autoUpdater = resolveAutoUpdater<AppUpdater>(updaterModule);
      autoUpdaterRef = autoUpdater;
      autoUpdater.logger = l;
      autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;

      autoUpdater.on("checking-for-update", () => {
        setState({ status: "checking" });
      });

      autoUpdater.on("update-available", (info: UpdateInfo) => {
        setState({ status: "available", version: info.version });
      });

      autoUpdater.on("update-not-available", () => {
        setState({ status: "not-available" });
      });

      autoUpdater.on("download-progress", (progress: ProgressInfo) => {
        const version =
          updateState.status === "downloading" ||
          updateState.status === "available"
            ? updateState.version
            : "";
        setState({ status: "downloading", version, percent: progress.percent });
      });

      // Do not quit here: the toast offers "Restart now", and
      // autoInstallOnAppQuit covers everyone who ignores it.
      autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
        setState({ status: "downloaded", version: info.version });
      });

      autoUpdater.on("error", (error: Error) => {
        recordDesktopError(OPERATION, error, { phase: updateState.status });
        setState({ status: "error", message: error.message });
      });

      void checkForUpdatesNow("startup");
      setInterval(() => {
        void checkForUpdatesNow("interval");
      }, AUTO_CHECK_INTERVAL_MS);
      app.on("browser-window-focus", () => {
        void checkForUpdatesNow("focus");
      });
    })
    .catch((error: unknown) => {
      // This also catches a throw from the setup above, so the reason has to
      // carry the real message: "module failed to load" sent the last
      // investigation after a packaging problem that did not exist.
      const detail = error instanceof Error ? error.message : String(error);
      disabledReason = `the updater failed to start (${detail})`;
      l.error(error);
      recordDesktopError(OPERATION, error, { phase: "load" });
      setState({ status: "error", message: "Updater unavailable" });
    });
}

/**
 * Runs an update check. Automatic sources are throttled; a check the user
 * asked for always runs and reports its outcome in a dialog.
 */
export async function checkForUpdatesNow(
  source: UpdateCheckSource,
): Promise<void> {
  const l = log();
  const manual = source === "manual";

  if (!autoUpdaterRef) {
    l.info(`check skipped (${source}): ${disabledReason ?? "not initialised"}`);
    if (manual) {
      await showDialog(
        "Updates are not available",
        disabledReason
          ? `Automatic updates are off: ${disabledReason}.`
          : "The updater has not finished starting. Try again in a moment.",
      );
    }
    return;
  }

  if (checkInFlight) {
    l.info(`check skipped (${source}): another check is in flight`);
    return;
  }

  const now = Date.now();
  if (
    !isForcedCheck(source) &&
    !shouldRunAutoCheck({ lastCheckAt, now, minGapMs: FOCUS_CHECK_MIN_GAP_MS })
  ) {
    return;
  }

  checkInFlight = true;
  lastCheckAt = now;
  l.info(`checking for updates (${source})`);
  try {
    await autoUpdaterRef.checkForUpdates();
    if (manual) await showManualCheckResult();
  } catch (error) {
    // The "error" event already recorded telemetry and updated the state.
    l.error(error);
    if (manual) {
      await showDialog(
        "Update check failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  } finally {
    checkInFlight = false;
  }
}

/**
 * Feedback for Help > Check for Updates. Main-process dialogs have no locale
 * plumbing, so these strings are English; the in-app toast is translated.
 */
async function showManualCheckResult(): Promise<void> {
  const current = app.getVersion();
  switch (updateState.status) {
    case "available":
    case "downloading":
      await showDialog(
        `Version ${updateState.version} is on its way`,
        "It is downloading in the background. You will be asked to restart once it is ready.",
      );
      return;
    case "downloaded":
      await showDialog(
        `Version ${updateState.version} is ready`,
        "Restart Keinsaas Navigator to finish the update.",
      );
      return;
    case "error":
      await showDialog("Update check failed", updateState.message);
      return;
    default:
      await showDialog(
        "You're up to date",
        `Keinsaas Navigator ${current} is the latest version.`,
      );
  }
}

async function showDialog(message: string, detail: string): Promise<void> {
  const options = {
    type: "info" as const,
    title: "Keinsaas Navigator",
    message,
    detail,
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    await dialog.showMessageBox(mainWindow, options);
  } else {
    await dialog.showMessageBox(options);
  }
}

export function registerUpdateIpcHandlers(): void {
  ipcMain.handle("updates:get-state", () => updateState);

  // Kept for web bundles that predate auto-download: starts (or joins) the
  // download of an available update.
  ipcMain.handle("updates:download-and-install", async () => {
    if (!autoUpdaterRef || updateState.status !== "available") return;
    const version = updateState.version;
    try {
      setState({ status: "downloading", version, percent: 0 });
      await autoUpdaterRef.downloadUpdate();
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  ipcMain.handle("updates:check", async () => {
    await checkForUpdatesNow("renderer");
  });

  ipcMain.handle("updates:restart-and-install", () => {
    if (!autoUpdaterRef || updateState.status !== "downloaded") return;
    log().info(`restart to install ${updateState.version}`);
    autoUpdaterRef.quitAndInstall(false, true);
  });
}

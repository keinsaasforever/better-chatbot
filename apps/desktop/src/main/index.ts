import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, session, shell } from "electron";
import {
  initAutoUpdater,
  registerUpdateIpcHandlers,
  setUpdateMainWindow,
} from "./auto-updater.js";
import { openCheckoutWindow } from "./checkout-window.js";
import { DESKTOP_PROTOCOL, findDeepLinkArg } from "./deep-link.js";
import { registerDownloadHandler } from "./downloads.js";
import {
  flushQueuedDeepLinks,
  focusMainWindow,
  handleAuthDeepLink,
  registerDesktopAuthIpcHandlers,
  setDesktopAuthMainWindow,
} from "./desktop-auth.js";
import { classifyNavigation } from "./external-links.js";
import { resolveAppIconPath } from "./icon.js";
import { registerIpcHandlers } from "./ipc-handlers.js";
import { registerMcpIpcHandlers } from "./mcp-ipc.js";
import { createApplicationMenu } from "./menu.js";
import {
  registerNotificationHandlers,
  setNotificationMainWindow,
} from "./notification-ipc.js";
import {
  initDesktopTelemetry,
  recordDesktopError,
  shutdownDesktopTelemetry,
} from "./otel.js";
import { resolveStartupServer } from "./server-config.js";
import {
  changeServer,
  openServerPickerWindow,
  registerServerPickerIpc,
} from "./server-picker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appIconPath = resolveAppIconPath();

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

// The cloud address is baked in at build time (scripts/build-main.mjs). It is
// what the first-run picker offers as "keinsaas Navigator (cloud)", not a
// fixed destination: a self-hosted better-chatbot can be chosen instead.
const cloudUrl = process.env.KEINSAAS_WEB_URL || "https://app.keinsaas.com";
const userDataDir = app.getPath("userData");
const startup = resolveStartupServer({
  isDev,
  devUrl: `http://localhost:${process.env.PORT || "3000"}`,
  cloudUrl,
  userDataDir,
});
/** Null on a first run, while the picker is open. */
const webUrl = "url" in startup ? startup.url : null;
const appOrigin = webUrl ? new URL(webUrl).origin : "";

// A `keinsaas://` launch on Windows and Linux starts a second copy of the app
// whose only job is to forward its argv to the running one. Without the lock
// the deep link would open a second window and the sign-in would be lost.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const link = findDeepLinkArg(argv);
    if (link) void handleAuthDeepLink(link);
    focusMainWindow();
  });
}

// macOS delivers protocol launches here, also on a cold start, so the listener
// has to exist before `ready`. Links that arrive before the window is up are
// queued and replayed by bootstrap.
app.on("open-url", (event, url) => {
  event.preventDefault();
  void handleAuthDeepLink(url);
});

registerProtocolClient();

/**
 * Packaged builds are registered by the installer (`protocols` in
 * electron-builder.yml); the runtime call keeps that registration pointing at
 * the current executable after an update. In development (`electron .`) the
 * registration has to carry the script path or Windows launches a bare
 * Electron with no app.
 */
function registerProtocolClient(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
    return;
  }
  app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL);
}

async function createMainWindow(webUrl: string): Promise<BrowserWindow> {
  const preloadPath = path.join(__dirname, "../preload/index.js");

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Keinsaas Navigator",
    ...(appIconPath ? { icon: appIconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  const openCheckout = (url: string) => {
    openCheckoutWindow({
      url,
      parent: window,
      appOrigin,
      onReturn: () => {
        if (window.isDestroyed()) return;
        window.webContents.send("billing:checkout-closed");
      },
    });
  };

  window.webContents.setWindowOpenHandler(({ url }) => {
    switch (classifyNavigation(url, appOrigin)) {
      case "app":
        return { action: "allow" };
      case "download":
        // A file response has nothing to show; a window opened for it stayed
        // blank. Hand it to the session's download pipeline (./downloads.ts).
        window.webContents.downloadURL(url);
        return { action: "deny" };
      case "checkout":
        openCheckout(url);
        return { action: "deny" };
      case "external":
        void shell.openExternal(url);
        return { action: "deny" };
      default:
        console.warn(`[desktop] blocked window.open to ${url}`);
        return { action: "deny" };
    }
  });

  window.webContents.on("will-navigate", (event, url) => {
    const action = classifyNavigation(url, appOrigin);
    // Same-origin routing navigates in place. Identity providers are *not*
    // allowed in here: they reject OAuth in embedded web views, so sign-in
    // runs in the system browser and returns via keinsaas:// (desktop-auth.ts).
    if (action === "app") return;

    event.preventDefault();
    if (action === "download") {
      window.webContents.downloadURL(url);
      return;
    }
    if (action === "checkout") {
      openCheckout(url);
      return;
    }
    if (action === "external") {
      void shell.openExternal(url);
      return;
    }
    console.warn(`[desktop] blocked navigation to ${url}`);
  });

  if (isDev) {
    window.webContents.on("console-message", (_event, _level, message) => {
      console.log(`[renderer] ${message}`);
    });
  }

  try {
    await window.loadURL(webUrl);
  } catch (error) {
    console.error(`Failed to load ${webUrl}:`, error);
    throw error;
  }

  if (isDev) {
    const bridge = await window.webContents.executeJavaScript(
      `window.desktop?.platform ?? "missing"`,
      true,
    );
    console.log(`[desktop] preload bridge platform=${bridge}`);
  }

  return window;
}

/** Creates the window and points every main-window-aware module at it. */
async function openMainWindow(): Promise<BrowserWindow> {
  if (!webUrl) {
    return openServerPickerWindow({
      userDataDir,
      cloudUrl,
      preloadPath: path.join(__dirname, "../preload/index.js"),
      iconPath: appIconPath,
    });
  }
  const window = await createMainWindow(webUrl);
  setNotificationMainWindow(window);
  setUpdateMainWindow(window);
  setDesktopAuthMainWindow(window);
  window.on("closed", () => {
    setNotificationMainWindow(null);
    setUpdateMainWindow(null);
    setDesktopAuthMainWindow(null);
  });
  return window;
}

async function bootstrap(): Promise<void> {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.keinsaas.navigator");
  }

  registerIpcHandlers();
  registerMcpIpcHandlers();
  registerNotificationHandlers();
  registerUpdateIpcHandlers();
  createApplicationMenu({
    host: webUrl ? new URL(webUrl).host : null,
    onChange: () => changeServer(userDataDir),
  });

  // First run: nothing that depends on the server starts until one is chosen.
  // The choice restarts the app (./server-picker.ts).
  if (!webUrl) {
    registerServerPickerIpc({ userDataDir, cloudUrl });
    try {
      await openMainWindow();
      initAutoUpdater();
    } catch (error) {
      console.error("Desktop startup failed:", error);
      recordDesktopError("desktop.bootstrap", error);
      void shutdownDesktopTelemetry().finally(() => app.exit(1));
    }
    return;
  }

  registerDesktopAuthIpcHandlers(webUrl);
  registerDownloadHandler(session.defaultSession, appOrigin);
  try {
    await openMainWindow();
    initAutoUpdater();

    // Cold start through the protocol handler (Windows/Linux put the URL in
    // argv); macOS links that arrived before the window existed were queued.
    const initialLink = findDeepLinkArg(process.argv);
    if (initialLink) void handleAuthDeepLink(initialLink);
    flushQueuedDeepLinks();
  } catch (error) {
    console.error("Desktop startup failed:", error);
    recordDesktopError("desktop.bootstrap", error);
    // Flush before exiting, otherwise the batch containing the very error that
    // killed startup is dropped.
    void shutdownDesktopTelemetry().finally(() => app.exit(1));
  }
}

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    // Off unless KEINSAAS_DESKTOP_TELEMETRY=1 — see ./otel.ts.
    initDesktopTelemetry(app.getVersion());
    void bootstrap();
  });
}

app.on("before-quit", () => {
  void shutdownDesktopTelemetry();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void openMainWindow().then(() => flushQueuedDeepLinks());
  }
});

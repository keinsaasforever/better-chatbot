import { BrowserWindow, app, ipcMain, net } from "electron";
import {
  buildServerPickerHtml,
  type PickerReason,
} from "./server-picker-page.js";
import {
  clearServerUrl,
  normalizeServerUrl,
  readPreviousServerUrl,
  writeServerUrl,
} from "./server-config.js";

type ChooseResult = { ok: true } | { ok: false; reason: PickerReason };

let pickerWindow: BrowserWindow | null = null;

/**
 * A server is accepted only if it answers like a better-chatbot or Navigator
 * instance: Better Auth's health endpoint returns `{ ok: true }`. Anything
 * else is refused before the shell trusts it with a session.
 */
async function checkServer(origin: string): Promise<ChooseResult> {
  try {
    const response = await net.fetch(`${origin}/api/auth/ok`, {
      signal: AbortSignal.timeout(8000),
    });
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
    } | null;
    return response.ok && body?.ok === true
      ? { ok: true }
      : { ok: false, reason: "not-navigator" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/** Restart so every module starts again from the new origin. */
function relaunch(): void {
  app.relaunch();
  app.exit(0);
}

export function registerServerPickerIpc(input: {
  userDataDir: string;
  cloudUrl: string;
}): void {
  ipcMain.handle(
    "server:choose",
    async (event, raw: unknown): Promise<ChooseResult> => {
      // Only the picker may change the server. The app window loads a remote
      // origin, and that origin must not be able to repoint the shell.
      if (
        !pickerWindow ||
        BrowserWindow.fromWebContents(event.sender) !== pickerWindow
      ) {
        return { ok: false, reason: "forbidden" };
      }

      const choice = (raw ?? {}) as { mode?: unknown; url?: unknown };
      let origin = input.cloudUrl;
      if (choice.mode === "own") {
        const normalized = normalizeServerUrl(String(choice.url ?? ""));
        if (!normalized.ok) return normalized;
        const reachable = await checkServer(normalized.origin);
        if (!reachable.ok) return reachable;
        origin = normalized.origin;
      }

      writeServerUrl(input.userDataDir, origin);
      setImmediate(relaunch);
      return { ok: true };
    },
  );
}

export async function openServerPickerWindow(input: {
  userDataDir: string;
  cloudUrl: string;
  preloadPath: string;
  iconPath?: string | null;
}): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 560,
    height: 560,
    resizable: false,
    show: false,
    title: "Keinsaas Navigator",
    ...(input.iconPath ? { icon: input.iconPath } : {}),
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  pickerWindow = window;
  window.on("closed", () => {
    pickerWindow = null;
  });
  window.once("ready-to-show", () => window.show());

  // The page is self-contained; nothing in it may navigate or open windows.
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const html = buildServerPickerHtml({
    locale: app.getLocale(),
    cloudUrl: input.cloudUrl,
    previous: readPreviousServerUrl(input.userDataDir),
  });
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
  return window;
}

/** "Change Server…": forget the choice and start over at the picker. */
export function changeServer(userDataDir: string): void {
  clearServerUrl(userDataDir);
  relaunch();
}

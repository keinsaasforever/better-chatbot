/**
 * Which server the desktop shell loads.
 *
 * One signed build serves everyone: keinsaas Navigator in the cloud, or a
 * self-hosted better-chatbot. The choice is made once, on a first run, and
 * stored in `<userData>/server.json`; "Change Server…" in the menu clears it.
 *
 * Pure module: no `electron` import, so it is unit-testable. The window, the
 * IPC handler and the relaunch live in ./server-picker.ts and ./index.ts.
 */
import fs from "node:fs";
import path from "node:path";

export const SERVER_FILE_NAME = "server.json";

type StoredServer = {
  /** The chosen origin, or absent while a new choice is pending. */
  url?: string;
  /** The last choice, offered again in the picker after "Change Server…". */
  previous?: string;
};

export type NormalizedServer =
  | { ok: true; origin: string }
  | { ok: false; reason: "empty" | "invalid" | "insecure" };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Turns what a person typed into an origin the shell may load: a bare
 * hostname gets https, anything after the host is dropped, and plain http is
 * accepted only for a server on this machine.
 */
export function normalizeServerUrl(input: string): NormalizedServer {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (url.protocol === "https:") return { ok: true, origin: url.origin };
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) {
    return { ok: true, origin: url.origin };
  }
  return {
    ok: false,
    reason: url.protocol === "http:" ? "insecure" : "invalid",
  };
}

function readStored(dir: string): StoredServer {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dir, SERVER_FILE_NAME), "utf8"),
    ) as StoredServer;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStored(dir: string, value: StoredServer): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SERVER_FILE_NAME), JSON.stringify(value));
}

/** The stored origin, re-validated so a hand-edited file cannot widen it. */
export function readServerUrl(dir: string): string | null {
  const { url } = readStored(dir);
  if (!url) return null;
  const normalized = normalizeServerUrl(url);
  return normalized.ok ? normalized.origin : null;
}

/** The last choice, to pre-fill the picker after "Change Server…". */
export function readPreviousServerUrl(dir: string): string | null {
  const { url, previous } = readStored(dir);
  return url ?? previous ?? null;
}

export function writeServerUrl(dir: string, origin: string): void {
  writeStored(dir, { url: origin });
}

/** Forget the choice so the next start shows the picker again. */
export function clearServerUrl(dir: string): void {
  const previous = readPreviousServerUrl(dir) ?? undefined;
  writeStored(dir, { previous });
}

/**
 * An install that ran before the picker existed has browser data from the
 * cloud. Its owner never chose anything and must not be asked now.
 */
export function isExistingInstall(dir: string): boolean {
  return ["Cookies", path.join("Network", "Cookies"), "Local Storage"].some(
    (entry) => fs.existsSync(path.join(dir, entry)),
  );
}

export type StartupServer = { url: string } | { pick: true };

/**
 * Where to go on start: the dev server in development, else the stored
 * choice, else the cloud for an install that predates the picker (recorded,
 * so this runs once), else the picker.
 */
export function resolveStartupServer(input: {
  isDev: boolean;
  devUrl: string;
  cloudUrl: string;
  userDataDir: string;
}): StartupServer {
  if (input.isDev) return { url: input.devUrl };

  const stored = readServerUrl(input.userDataDir);
  if (stored) return { url: stored };

  const neverChose = !fs.existsSync(
    path.join(input.userDataDir, SERVER_FILE_NAME),
  );
  if (neverChose && isExistingInstall(input.userDataDir)) {
    writeServerUrl(input.userDataDir, input.cloudUrl);
    return { url: input.cloudUrl };
  }

  return { pick: true };
}

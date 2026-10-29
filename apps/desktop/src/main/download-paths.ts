import path from "node:path";

/**
 * Pure helpers behind ./downloads.ts, kept free of `electron` so they can be
 * unit-tested like ./set-cookie.ts and ./pending-sign-in.ts.
 */

/** Characters no OS accepts in a file name (besides path separators). */
const FORBIDDEN = new Set(["<", ">", ":", '"', "|", "?", "*"]);

/** Strips anything Chromium or the OS would refuse in a file name. */
export function sanitizeDownloadFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = Array.from(base)
    .map((ch) => (ch.charCodeAt(0) < 32 || FORBIDDEN.has(ch) ? "_" : ch))
    .join("")
    .replace(/^\.+/, "")
    .trim();
  return cleaned || "download";
}

/** Where the Save As dialog starts: the OS Downloads folder, the file's own name. */
export function defaultSavePath(
  downloadsDir: string,
  filename: string,
): string {
  return path.join(downloadsDir, sanitizeDownloadFilename(filename));
}

/**
 * A URL as it may appear in a log line: origin and path only. The query string
 * carries the storage key today and a signed token after the redirect change.
 */
export function describeDownloadUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "(invalid url)";
  }
}

export type DownloadNotificationState = "completed" | "failed";

type NotificationText = {
  title: string;
  body: (filename: string) => string;
};

/**
 * The main process cannot read next-intl, so these are the desktop-side
 * counterpart of the `Chat.Tool.*` download strings in apps/web/messages.
 * Keep the two in step when either changes.
 */
const TEXTS: Record<
  string,
  Record<DownloadNotificationState, NotificationText>
> = {
  en: {
    completed: { title: "Download complete", body: (f) => `${f} was saved.` },
    failed: {
      title: "Download failed",
      body: (f) => `${f} could not be downloaded.`,
    },
  },
  de: {
    completed: {
      title: "Download abgeschlossen",
      body: (f) => `${f} wurde gespeichert.`,
    },
    failed: {
      title: "Download fehlgeschlagen",
      body: (f) => `${f} konnte nicht heruntergeladen werden.`,
    },
  },
  es: {
    completed: {
      title: "Descarga completada",
      body: (f) => `${f} se ha guardado.`,
    },
    failed: {
      title: "Error de descarga",
      body: (f) => `No se pudo descargar ${f}.`,
    },
  },
  fr: {
    completed: {
      title: "Téléchargement terminé",
      body: (f) => `${f} a été enregistré.`,
    },
    failed: {
      title: "Échec du téléchargement",
      body: (f) => `${f} n'a pas pu être téléchargé.`,
    },
  },
  ja: {
    completed: {
      title: "ダウンロード完了",
      body: (f) => `${f} を保存しました。`,
    },
    failed: {
      title: "ダウンロード失敗",
      body: (f) => `${f} をダウンロードできませんでした。`,
    },
  },
  ko: {
    completed: {
      title: "다운로드 완료",
      body: (f) => `${f}을(를) 저장했습니다.`,
    },
    failed: {
      title: "다운로드 실패",
      body: (f) => `${f}을(를) 다운로드할 수 없습니다.`,
    },
  },
  pt: {
    completed: { title: "Download concluído", body: (f) => `${f} foi salvo.` },
    failed: {
      title: "Falha no download",
      body: (f) => `Não foi possível baixar ${f}.`,
    },
  },
  zh: {
    completed: { title: "下载完成", body: (f) => `${f} 已保存。` },
    failed: { title: "下载失败", body: (f) => `无法下载 ${f}。` },
  },
};

export function downloadNotificationText(
  locale: string,
  filename: string,
  state: DownloadNotificationState,
): { title: string; body: string } {
  const language = locale.toLowerCase().split(/[-_]/)[0] ?? "";
  const table = TEXTS[language] ?? TEXTS.en;
  const entry = table[state];
  return { title: entry.title, body: entry.body(filename) };
}

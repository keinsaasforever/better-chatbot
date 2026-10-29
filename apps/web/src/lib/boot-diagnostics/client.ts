"use client";

export type BootClientEvent =
  | "anchor-click"
  | "beforeunload"
  | "chatbot-mount"
  | "chatbot-unmount"
  | "client-boot"
  | "error"
  | "pagehide"
  | "pageshow"
  | "popstate"
  | "react-mount"
  | "react-unmount"
  | "recoverable-error"
  | "shell-mount"
  | "shell-unmount"
  | "unhandledrejection"
  | "visibilitychange";

type BootContext = {
  documentId: string;
  visitId: string;
};

type PendingEvent = {
  event: BootClientEvent;
  details?: Record<string, unknown>;
};

type BootClientState = {
  context: BootContext | null;
  documentSequence: number;
  installed: boolean;
  navigationType: string;
  pending: PendingEvent[];
  serverHtml: { serverBodyChildCount: number; serverBodyTextLength: number };
  tabId: string;
};

declare global {
  interface Window {
    __bootClientState?: BootClientState;
  }
}

const MAX_PENDING_EVENTS = 20;

function randomId() {
  return crypto.randomUUID();
}

function readSessionNumber(key: string) {
  try {
    return Number(sessionStorage.getItem(key) ?? "0");
  } catch {
    return 0;
  }
}

function writeSessionValue(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // sessionStorage can be unavailable in hardened/private browser contexts.
  }
}

function getNavigationEntry() {
  return (
    performance.getEntriesByType("navigation") as Array<
      PerformanceNavigationTiming & {
        activationStart?: number;
        deliveryType?: string;
      }
    >
  )[0];
}

function getState(): BootClientState | null {
  if (typeof window === "undefined") return null;
  if (window.__bootClientState) return window.__bootClientState;

  let tabId: string;
  try {
    tabId = sessionStorage.getItem("__boot_tab") || randomId();
  } catch {
    tabId = randomId();
  }
  writeSessionValue("__boot_tab", tabId);

  const documentSequence = readSessionNumber("__boot_documents") + 1;
  writeSessionValue("__boot_documents", String(documentSequence));

  window.__bootClientState = {
    context: null,
    documentSequence,
    installed: false,
    navigationType: getNavigationEntry()?.type ?? "unknown",
    pending: [],
    serverHtml: { serverBodyChildCount: -1, serverBodyTextLength: -1 },
    tabId,
  };
  return window.__bootClientState;
}

function safePath(value: string) {
  try {
    const url = new URL(value, location.origin);
    return `${url.origin === location.origin ? "" : url.origin}${url.pathname}`;
  } catch {
    return "(invalid)";
  }
}

function safeText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/([?&][^=\s]+)=([^&\s]+)/g, "$1=[redacted]")
    .slice(0, maxLength);
}

function send(event: BootClientEvent, details?: Record<string, unknown>) {
  const state = getState();
  if (!state) return;
  if (!state.context) {
    state.pending.push({ event, details });
    state.pending = state.pending.slice(-MAX_PENDING_EVENTS);
    return;
  }

  const payload = JSON.stringify({
    event,
    visitId: state.context.visitId,
    documentId: state.context.documentId,
    tabId: state.tabId,
    documentSequence: state.documentSequence,
    at: new Date().toISOString(),
    elapsedMs: Math.round(performance.now()),
    path: location.pathname,
    navigationType: state.navigationType,
    details: details ?? {},
  });
  const body = new Blob([payload], { type: "application/json" });

  if (!navigator.sendBeacon("/api/_boot", body)) {
    void fetch("/api/_boot", {
      body: payload,
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  }
}

/**
 * Size of `<body>` as the server sent it.
 *
 * This module runs from a deferred bundle, so the HTML is fully parsed but React
 * has not hydrated yet — the DOM here is exactly the server's markup. A near
 * empty body means the app was excluded from the server render and will be
 * painted client-side only, which reads to users as the page loading twice. That
 * failure mode is invisible to the document/mount counters, so measure it
 * directly instead of inferring it.
 */
function measureServerHtml() {
  try {
    return {
      serverBodyChildCount: document.body.childElementCount,
      serverBodyTextLength: (document.body.textContent ?? "").trim().length,
    };
  } catch {
    return { serverBodyChildCount: -1, serverBodyTextLength: -1 };
  }
}

function firstContentfulPaintMs() {
  try {
    const entry = performance.getEntriesByName("first-contentful-paint")[0];
    return entry ? Math.round(entry.startTime) : null;
  } catch {
    return null;
  }
}

function installEarlyListeners() {
  const state = getState();
  if (!state || state.installed) return;
  state.installed = true;
  state.serverHtml = measureServerHtml();

  window.addEventListener(
    "error",
    (event) => {
      send("error", {
        message: safeText(event.message || event.error, 300),
        source: event.filename ? safePath(event.filename) : "(none)",
        stack: safeText(event.error?.stack, 1200),
      });
    },
    true,
  );
  window.addEventListener("unhandledrejection", (event) => {
    send("unhandledrejection", {
      message: safeText(event.reason?.message ?? event.reason, 300),
      stack: safeText(event.reason?.stack, 1200),
    });
  });
  window.addEventListener("beforeunload", () => send("beforeunload"));
  window.addEventListener("pagehide", (event) => {
    send("pagehide", { persisted: event.persisted });
  });
  window.addEventListener("pageshow", (event) => {
    send("pageshow", { persisted: event.persisted });
  });
  window.addEventListener("popstate", () => send("popstate"));
  document.addEventListener("visibilitychange", () => {
    send("visibilitychange", { visibilityState: document.visibilityState });
  });
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      send("anchor-click", {
        button: event.button,
        href: safePath(anchor.href),
        target: anchor.target || "(self)",
      });
    },
    true,
  );
}

export function configureBootDiagnostics(context: BootContext) {
  const state = getState();
  if (!state) return;
  state.context = context;

  const navigation = getNavigationEntry();
  const connection = (
    navigator as Navigator & {
      connection?: {
        effectiveType?: string;
        saveData?: boolean;
      };
      standalone?: boolean;
    }
  ).connection;
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  send("client-boot", {
    activationStart: Math.round(navigation?.activationStart ?? 0),
    deliveryType: navigation?.deliveryType || "(unknown)",
    documentReferrer: document.referrer
      ? safePath(document.referrer)
      : "(none)",
    domInteractive: Math.round(navigation?.domInteractive ?? 0),
    effectiveConnectionType: connection?.effectiveType ?? "(unknown)",
    fetchStart: Math.round(navigation?.fetchStart ?? 0),
    loadEventEnd: Math.round(navigation?.loadEventEnd ?? 0),
    redirectCount: navigation?.redirectCount ?? 0,
    responseStart: Math.round(navigation?.responseStart ?? 0),
    responseEnd: Math.round(navigation?.responseEnd ?? 0),
    saveData: connection?.saveData ?? false,
    ...state.serverHtml,
    standalone,
    transferSize: navigation?.transferSize ?? 0,
    wasDiscarded:
      (document as Document & { wasDiscarded?: boolean }).wasDiscarded ?? false,
    workerStart: Math.round(navigation?.workerStart ?? 0),
  });

  const pending = state.pending.splice(0);
  for (const item of pending) {
    send(item.event, item.details);
  }
}

export function recordBootEvent(
  event: BootClientEvent,
  details?: Record<string, unknown>,
) {
  send(event, details);
}

/**
 * Reports the app shell mounting from *inside* the provider tree. `react-mount`
 * comes from a detector that sits above every provider in the root layout, so it
 * can never observe the wrapped subtree — a provider that withholds its children
 * leaves `react-mount: 1` and no other trace. Pair the two: a `shell-mount` that
 * lands far after `first-contentful-paint`, or that repeats while `react-mount`
 * stays at 1, is the signal that counter cannot give.
 */
export function recordShellMount(mountCount: number) {
  const state = getState();
  send("shell-mount", {
    firstContentfulPaint: firstContentfulPaintMs(),
    mountCount,
    ...(state?.serverHtml ?? {}),
  });
}

installEarlyListeners();

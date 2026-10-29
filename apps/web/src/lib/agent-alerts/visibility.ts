const RECENTLY_VISIBLE_MS = 1500;

let becameVisibleAt: number | null = null;

function markVisible(): void {
  becameVisibleAt = Date.now();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      markVisible();
    }
  });
  window.addEventListener("focus", markVisible);
}

export function isAppAway(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.hidden || !document.hasFocus();
}

export function shouldForceAwayNotification(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  if (document.hidden || !document.hasFocus()) {
    return true;
  }
  return (
    becameVisibleAt !== null &&
    Date.now() - becameVisibleAt < RECENTLY_VISIBLE_MS
  );
}

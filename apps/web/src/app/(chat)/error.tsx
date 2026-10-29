"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "ui/button";

/**
 * Error boundary for the authed product surface.
 *
 * Until this existed the app had none at all — no `error.tsx`, no
 * `global-error.tsx`, no `componentDidCatch` anywhere — so a single uncaught
 * throw during render or in an effect unmounted the entire client tree and
 * left Next.js's built-in root fallback ("Application error: a client-side
 * exception has occurred"). That took the chat down with it, including any
 * client-side tool call still waiting to be answered, which turned a local
 * rendering bug into a dead thread and an abandoned run.
 *
 * Scoped to the route group so a failure here keeps the shell and offers a
 * retry that re-renders the segment rather than reloading the whole app.
 */
export default function ChatSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The boundary swallows the throw, so without this the stack never reaches
    // the console the user is asked to check.
    console.error("Chat segment error:", error);
  }, [error]);

  const t = useTranslations("Error");

  return (
    <div className="h-full w-full flex items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <AlertTriangle className="size-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="text-xs text-muted-foreground mt-2">{t("description")}</p>
        {error.digest ? (
          <p className="text-[11px] text-muted-foreground/70 mt-3 font-mono">
            {error.digest}
          </p>
        ) : null}
        <Button variant="outline" size="sm" className="mt-4" onClick={reset}>
          {t("retry")}
        </Button>
      </div>
    </div>
  );
}

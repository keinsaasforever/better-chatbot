"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTranslations } from "next-intl";

/**
 * Shown inside the desktop app while the user finishes signing in through the
 * system browser. The shell swaps this out for the app once the keinsaas://
 * handoff lands, so there is nothing to poll here.
 */
export function DesktopSignInPending({
  onReopen,
  onCancel,
}: {
  onReopen: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Auth.Desktop");
  return (
    <Card
      className="w-full md:max-w-md bg-background border-none mx-auto shadow-none animate-in fade-in duration-500"
      data-testid="desktop-sign-in-pending"
    >
      <CardHeader className="my-4">
        <CardTitle className="text-2xl text-center my-1">
          {t("continueInBrowser")}
        </CardTitle>
        <CardDescription className="text-center text-muted-foreground">
          {t("continueInBrowserDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Button className="w-full" onClick={onReopen}>
          {t("openBrowserAgain")}
        </Button>
        <Button variant="ghost" className="w-full" onClick={onCancel}>
          {t("back")}
        </Button>
      </CardContent>
    </Card>
  );
}

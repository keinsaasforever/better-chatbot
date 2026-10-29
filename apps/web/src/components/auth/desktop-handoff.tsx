"use client";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "lib/utils";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

/**
 * The browser-side end of a desktop sign-in: opens the keinsaas:// link that
 * carries the one-time token back to the app, and keeps a real link on screen
 * in case the browser asks for a click before launching a protocol handler.
 */
export function DesktopHandoff({ deepLink }: { deepLink: string }) {
  const t = useTranslations("Auth.Desktop");

  useEffect(() => {
    window.location.assign(deepLink);
  }, [deepLink]);

  return (
    <div className="w-full h-full flex flex-col p-4 md:p-8 justify-center">
      <Card className="w-full md:max-w-md bg-background border-none mx-auto shadow-none animate-in fade-in duration-500">
        <CardHeader className="my-4">
          <CardTitle className="text-2xl text-center my-1">
            {t("handoffTitle")}
          </CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            {t("handoffDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <a
            href={deepLink}
            className={cn(buttonVariants({ variant: "default" }), "w-full")}
            data-testid="desktop-return-to-app"
          >
            {t("returnToApp")}
          </a>
          <p className="text-sm text-center text-muted-foreground">
            {t("handoffHint")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function DesktopHandoffInvalid() {
  const t = useTranslations("Auth.Desktop");
  return (
    <div className="w-full h-full flex flex-col p-4 md:p-8 justify-center">
      <Card className="w-full md:max-w-md bg-background border-none mx-auto shadow-none">
        <CardHeader className="my-4">
          <CardTitle className="text-2xl text-center my-1">
            {t("invalidLinkTitle")}
          </CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            {t("invalidLinkDescription")}
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

"use client";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { analytics } from "@/lib/analytics/posthog";
import { callbackUrlQuery } from "@/lib/auth/callback-url";
import { SocialAuthenticationProvider } from "app-types/authentication";
import { authClient } from "auth/client";
import { cn } from "lib/utils";
import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { startTransition } from "react";
import { toast } from "sonner";
import { useDesktopBrowserSignIn } from "@/hooks/use-desktop-browser-sign-in";
import { DesktopSignInPending } from "./desktop-sign-in-pending";
import SocialProviders from "./social-providers";

export default function SignUpPage({
  emailAndPasswordEnabled,
  socialAuthenticationProviders,
  isFirstUser,
  callbackUrl,
}: {
  emailAndPasswordEnabled: boolean;
  socialAuthenticationProviders: SocialAuthenticationProvider[];
  isFirstUser: boolean;
  callbackUrl?: string;
}) {
  const t = useTranslations();
  // Inside the desktop app a provider sign-up has to run in the system
  // browser; providers refuse OAuth in embedded web views.
  const desktop = useDesktopBrowserSignIn({ page: "sign-up", callbackUrl });
  const handleSocialSignIn = (provider: SocialAuthenticationProvider) => {
    if (desktop.available) {
      void desktop.start(provider);
      return;
    }
    startTransition(async () => {
      try {
        await authClient.signIn.social(
          { provider, callbackURL: callbackUrl || "/" },
          {
            onSuccess(ctx) {
              // Track successful social sign-up
              if (ctx.data?.user?.id) {
                analytics.identify(ctx.data.user.id, {
                  email: ctx.data.user.email,
                  name: ctx.data.user.name,
                });
                analytics.userSignedUp({
                  method: provider,
                  userId: ctx.data.user.id,
                  email: ctx.data.user.email,
                  isFirstUser,
                });
              }
            },
          },
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Unknown error");
      }
    });
  };
  if (desktop.pending) {
    return (
      <DesktopSignInPending
        onReopen={desktop.reopen}
        onCancel={desktop.cancel}
      />
    );
  }
  return (
    <Card className="w-full md:max-w-md bg-background border-none mx-auto shadow-none">
      <CardHeader>
        <CardTitle className="text-2xl text-center ">
          {isFirstUser ? t("Auth.SignUp.titleAdmin") : t("Auth.SignUp.title")}
        </CardTitle>
        <CardDescription className="text-center">
          {isFirstUser
            ? t("Auth.SignUp.signUpDescriptionAdmin")
            : t("Auth.SignUp.signUpDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {emailAndPasswordEnabled && (
          <Link
            href={`/sign-up/email${callbackUrlQuery(callbackUrl)}`}
            data-testid="email-signup-button"
            className={cn(buttonVariants({ variant: "default" }), "w-full")}
          >
            <Mail className="size-4" />
            {t("Auth.SignUp.email")}
          </Link>
        )}
        {socialAuthenticationProviders.length > 0 && (
          <>
            {emailAndPasswordEnabled && (
              <div className="flex items-center my-4">
                <div className="flex-1 h-px bg-accent"></div>
                <span className="px-4 text-sm text-muted-foreground">
                  {t("Auth.SignIn.orContinueWith")}
                </span>
                <div className="flex-1 h-px bg-accent"></div>
              </div>
            )}
            <SocialProviders
              socialAuthenticationProviders={socialAuthenticationProviders}
              onSocialProviderClick={handleSocialSignIn}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

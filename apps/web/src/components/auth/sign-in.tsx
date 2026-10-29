"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDesktopBrowserSignIn } from "@/hooks/use-desktop-browser-sign-in";
import { useObjectState } from "@/hooks/use-object-state";
import Link from "next/link";
import { useState } from "react";

import { analytics } from "@/lib/analytics/posthog";
import { callbackUrlQuery } from "@/lib/auth/callback-url";
import { SocialAuthenticationProvider } from "app-types/authentication";
import { authClient } from "auth/client";
import { Loader } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { safe } from "ts-safe";
import { GithubIcon } from "ui/github-icon";
import { GoogleIcon } from "ui/google-icon";
import { MicrosoftIcon } from "ui/microsoft-icon";
import { DesktopSignInPending } from "./desktop-sign-in-pending";
import { useCaptcha } from "./use-captcha";

export default function SignIn({
  emailAndPasswordEnabled,
  signUpEnabled,
  socialAuthenticationProviders,
  isFirstUser,
  callbackUrl,
}: {
  emailAndPasswordEnabled: boolean;
  signUpEnabled: boolean;
  socialAuthenticationProviders: SocialAuthenticationProvider[];
  isFirstUser: boolean;
  callbackUrl?: string;
}) {
  const t = useTranslations("Auth.SignIn");

  const [loading, setLoading] = useState(false);
  const captcha = useCaptcha();
  const redirectTo = callbackUrl || "/";
  // Inside the desktop app a provider sign-in has to run in the system
  // browser; providers refuse OAuth in embedded web views.
  const desktop = useDesktopBrowserSignIn({ page: "sign-in", callbackUrl });

  const [formData, setFormData] = useObjectState({
    email: "",
    password: "",
  });

  const emailAndPasswordSignIn = () => {
    setLoading(true);
    safe(() =>
      authClient.signIn.email(
        {
          email: formData.email,
          password: formData.password,
          callbackURL: redirectTo,
        },
        {
          headers: captcha.headers,
          onSuccess(ctx) {
            // Track successful sign-in
            if (ctx.data?.user?.id) {
              analytics.identify(ctx.data.user.id, {
                email: ctx.data.user.email,
                name: ctx.data.user.name,
              });
              analytics.userSignedIn({
                method: "email",
                userId: ctx.data.user.id,
                email: ctx.data.user.email,
              });
            }
          },
          onError(ctx) {
            toast.error(ctx.error.message || ctx.error.statusText);
          },
        },
      ),
    )
      .watch(() => {
        setLoading(false);
        // Single-use token: the next attempt needs a fresh one.
        captcha.reset();
      })
      .unwrap();
  };

  const handleSocialSignIn = (provider: SocialAuthenticationProvider) => {
    if (desktop.available) {
      void desktop.start(provider);
      return;
    }
    authClient.signIn
      .social(
        { provider, callbackURL: redirectTo },
        {
          onSuccess(ctx) {
            // Track successful social sign-in
            if (ctx.data?.user?.id) {
              analytics.identify(ctx.data.user.id, {
                email: ctx.data.user.email,
                name: ctx.data.user.name,
              });
              analytics.userSignedIn({
                method: provider,
                userId: ctx.data.user.id,
                email: ctx.data.user.email,
              });
            }
          },
        },
      )
      .catch((e) => {
        toast.error(e.error);
      });
  };
  if (desktop.pending) {
    return (
      <div className="w-full h-full flex flex-col p-4 md:p-8 justify-center">
        <DesktopSignInPending
          onReopen={desktop.reopen}
          onCancel={desktop.cancel}
        />
      </div>
    );
  }
  return (
    <div className="w-full h-full flex flex-col p-4 md:p-8 justify-center">
      <Card className="w-full md:max-w-md bg-background border-none mx-auto shadow-none animate-in fade-in duration-1000">
        <CardHeader className="my-4">
          <CardTitle className="text-2xl text-center my-1">
            {t("title")}
          </CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            {t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">
          {emailAndPasswordEnabled && !isFirstUser && (
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  autoFocus
                  disabled={loading}
                  value={formData.email}
                  onChange={(e) => setFormData({ email: e.target.value })}
                  type="email"
                  placeholder="user@example.com"
                  required
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="/forgot-password"
                    className="ml-auto text-sm underline-offset-4 text-muted-foreground hover:text-primary hover:underline"
                  >
                    {t("forgotPassword")}
                  </Link>
                </div>
                <Input
                  id="password"
                  disabled={loading}
                  value={formData.password}
                  placeholder="********"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      emailAndPasswordSignIn();
                    }
                  }}
                  onChange={(e) => setFormData({ password: e.target.value })}
                  type="password"
                  required
                />
              </div>
              {captcha.widget}
              <Button
                className="w-full"
                onClick={emailAndPasswordSignIn}
                disabled={loading || !captcha.ready}
                data-testid="signin-submit-button"
              >
                {loading ? (
                  <Loader className="size-4 animate-spin ml-1" />
                ) : (
                  t("signIn")
                )}
              </Button>
            </div>
          )}
          {socialAuthenticationProviders.length > 0 && (
            <>
              {emailAndPasswordEnabled && (
                <div className="flex items-center my-4">
                  <div className="flex-1 h-px bg-accent"></div>
                  <span className="px-4 text-sm text-muted-foreground">
                    {t("orContinueWith")}
                  </span>
                  <div className="flex-1 h-px bg-accent"></div>
                </div>
              )}
              <div className="flex flex-col gap-2 w-full">
                {socialAuthenticationProviders.includes("google") && (
                  <Button
                    variant="outline"
                    onClick={() => handleSocialSignIn("google")}
                    className="flex-1 w-full"
                  >
                    <GoogleIcon className="size-4 fill-foreground" />
                    Google
                  </Button>
                )}
                {socialAuthenticationProviders.includes("github") && (
                  <Button
                    variant="outline"
                    onClick={() => handleSocialSignIn("github")}
                    className="flex-1 w-full"
                  >
                    <GithubIcon className="size-4 fill-foreground" />
                    GitHub
                  </Button>
                )}
                {socialAuthenticationProviders.includes("microsoft") && (
                  <Button
                    variant="outline"
                    onClick={() => handleSocialSignIn("microsoft")}
                    className="flex-1 w-full"
                  >
                    <MicrosoftIcon className="size-4 fill-foreground" />
                    Microsoft
                  </Button>
                )}
              </div>
            </>
          )}
          {signUpEnabled && (
            <div className="my-8 text-center text-sm text-muted-foreground">
              {t("noAccount")}
              <Link
                href={`/sign-up${callbackUrlQuery(callbackUrl)}`}
                className="underline-offset-4 text-primary"
              >
                {t("signUp")}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

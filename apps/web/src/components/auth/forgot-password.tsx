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
import { authClient } from "auth/client";
import { ChevronLeft, Loader } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { safe } from "ts-safe";
import { useCaptcha } from "./use-captcha";

export default function ForgotPassword() {
  const t = useTranslations("Auth.ForgotPassword");

  const captcha = useCaptcha();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [email, setEmail] = useState("");

  const requestReset = () => {
    if (!email.trim()) {
      toast.error(t("emailRequired"));
      return;
    }
    setLoading(true);
    safe(() =>
      authClient.requestPasswordReset(
        {
          email: email.trim(),
          redirectTo: "/reset-password",
        },
        {
          headers: captcha.headers,
          onError(ctx) {
            toast.error(ctx.error.message || ctx.error.statusText);
          },
          onSuccess() {
            // Always show the same confirmation regardless of whether the
            // email exists, so we never leak account existence.
            setSubmitted(true);
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

  return (
    <div className="w-full h-full flex flex-col p-4 md:p-8 justify-center">
      <Card className="w-full md:max-w-md bg-background border-none mx-auto shadow-none animate-in fade-in duration-1000">
        <CardHeader className="my-4">
          <CardTitle className="text-2xl text-center my-1">
            {t("title")}
          </CardTitle>
          <CardDescription className="text-center text-muted-foreground">
            {submitted ? t("checkEmailDescription") : t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">
          {submitted ? (
            <p className="text-sm text-muted-foreground text-center">
              {t("checkEmailBody", { email })}
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  autoFocus
                  disabled={loading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      requestReset();
                    }
                  }}
                  type="email"
                  placeholder="user@example.com"
                  required
                />
              </div>
              {captcha.widget}
              <Button
                className="w-full"
                onClick={requestReset}
                disabled={loading || !captcha.ready}
                data-testid="forgot-password-submit-button"
              >
                {loading ? (
                  <Loader className="size-4 animate-spin ml-1" />
                ) : (
                  t("sendResetLink")
                )}
              </Button>
            </div>
          )}
          <div className="my-8 text-center text-sm">
            <Link
              href="/sign-in"
              className="inline-flex items-center text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
            >
              <ChevronLeft className="size-4" />
              {t("backToSignIn")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

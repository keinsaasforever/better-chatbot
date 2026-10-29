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
import {
  passwordRegexPattern,
  passwordRequirementsText,
  passwordSchema,
} from "lib/validations/password";
import { Loader } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { safe } from "ts-safe";

export default function ResetPassword() {
  const t = useTranslations("Auth.ResetPassword");
  const router = useRouter();
  const searchParams = useSearchParams();

  const token = searchParams.get("token");
  const errorParam = searchParams.get("error");

  const [loading, setLoading] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const invalidToken = !token || Boolean(errorParam);

  const submit = () => {
    if (!token) return;

    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) {
      toast.error(parsed.error.issues.map((i) => i.message).join("\n\n"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("passwordMismatch"));
      return;
    }

    setLoading(true);
    safe(() =>
      authClient.resetPassword(
        { newPassword, token },
        {
          onError(ctx) {
            toast.error(ctx.error.message || ctx.error.statusText);
          },
          onSuccess() {
            router.push("/sign-in");
          },
        },
      ),
    )
      .watch(() => setLoading(false))
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
            {invalidToken ? t("invalidTokenDescription") : t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col">
          {invalidToken ? (
            <div className="my-4 text-center text-sm">
              <Link
                href="/forgot-password"
                className="underline-offset-4 text-primary hover:underline"
              >
                {t("requestNewLink")}
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="newPassword">{t("newPassword")}</Label>
                <Input
                  id="newPassword"
                  autoFocus
                  disabled={loading}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  type="password"
                  placeholder="********"
                  pattern={passwordRegexPattern}
                  minLength={8}
                  maxLength={20}
                  title={passwordRequirementsText}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
                <Input
                  id="confirmPassword"
                  disabled={loading}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      submit();
                    }
                  }}
                  type="password"
                  placeholder="********"
                  pattern={passwordRegexPattern}
                  minLength={8}
                  maxLength={20}
                  title={passwordRequirementsText}
                  required
                />
              </div>
              <Button
                className="w-full"
                onClick={submit}
                disabled={loading}
                data-testid="reset-password-submit-button"
              >
                {loading ? (
                  <Loader className="size-4 animate-spin ml-1" />
                ) : (
                  t("resetPassword")
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

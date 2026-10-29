"use client";

import { existsByEmailAction } from "@/app/api/auth/actions";
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
import { useObjectState } from "@/hooks/use-object-state";
import { analytics } from "@/lib/analytics/posthog";
import { UserZodSchema } from "app-types/user";
import { authClient } from "auth/client";
import { cn } from "lib/utils";
import { ChevronLeft, Loader } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { safe } from "ts-safe";
import { useCaptcha } from "./use-captcha";

export default function EmailSignUp({
  isFirstUser,
  callbackUrl,
}: {
  isFirstUser: boolean;
  callbackUrl?: string;
}) {
  const t = useTranslations();
  const [step, setStep] = useState(1);
  const router = useRouter();
  const captcha = useCaptcha();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useObjectState({
    email: "",
    name: "",
    password: "",
  });

  const steps = [
    t("Auth.SignUp.step1"),
    t("Auth.SignUp.step2"),
    t("Auth.SignUp.step3"),
  ];

  const safeProcessWithLoading = function <T>(fn: () => Promise<T>) {
    setIsLoading(true);
    return safe(() => fn()).watch(() => setIsLoading(false));
  };

  const backStep = () => {
    setStep(Math.max(step - 1, 1));
  };

  const successEmailStep = async () => {
    const { success } = UserZodSchema.shape.email.safeParse(formData.email);
    if (!success) {
      toast.error(t("Auth.SignUp.invalidEmail"));
      return;
    }
    const exists = await safeProcessWithLoading(() =>
      existsByEmailAction(formData.email),
    ).orElse(false);
    if (exists) {
      toast.error(t("Auth.SignUp.emailAlreadyExists"));
      return;
    }
    setStep(2);
  };

  const successNameStep = () => {
    const { success } = UserZodSchema.shape.name.safeParse(formData.name);
    if (!success) {
      toast.error(t("Auth.SignUp.nameRequired"));
      return;
    }
    setStep(3);
  };

  const successPasswordStep = async () => {
    // client side validation
    const { success: passwordSuccess, error: passwordError } =
      UserZodSchema.shape.password.safeParse(formData.password);
    if (!passwordSuccess) {
      const errorMessages = passwordError.issues.map((e) => e.message);
      toast.error(errorMessages.join("\n\n"));
      return;
    }

    // Signs up over the Better Auth HTTP endpoint rather than a server action:
    // the Turnstile plugin hooks `onRequest`, which only runs on the handler,
    // so a server action calling `auth.api.signUpEmail` would skip the captcha
    // entirely — and be a second unprotected POST surface besides. Password
    // policy is enforced server-side by the `before` hook in auth-instance.ts.
    const { error } = await safeProcessWithLoading(() =>
      authClient.signUp.email(
        {
          email: formData.email,
          name: formData.name,
          password: formData.password,
        },
        { headers: captcha.headers },
      ),
    ).unwrap();
    // Turnstile tokens are single-use, so the next attempt needs a fresh one
    // whether this one succeeded or not.
    captcha.reset();
    if (!error) {
      // Get the newly created user session and track sign-up
      const session = await authClient.getSession();
      if (session?.data?.user?.id) {
        analytics.identify(session.data.user.id, {
          email: session.data.user.email,
          name: session.data.user.name,
        });
        analytics.userSignedUp({
          method: "email",
          userId: session.data.user.id,
          email: session.data.user.email,
          isFirstUser,
        });
      }

      // When the sign-up was started from an invite link (or any other
      // callbackUrl), return the user there so they can immediately accept the
      // invitation instead of being dropped into onboarding.
      router.push(callbackUrl || "/onboarding");
    } else {
      toast.error(error.message || error.statusText);
    }
  };

  return (
    <Card className="w-full md:max-w-md bg-background border-none mx-auto gap-0 shadow-none animate-in fade-in duration-1000">
      <CardHeader>
        <CardTitle className="text-2xl text-center ">
          {isFirstUser ? t("Auth.SignUp.titleAdmin") : t("Auth.SignUp.title")}
        </CardTitle>
        <CardDescription className="py-12">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground text-right">
              Step {step} of {steps.length}
            </p>
            <div className="h-2 w-full relative bg-input">
              <div
                style={{
                  width: `${(step / 3) * 100}%`,
                }}
                className="h-full bg-primary transition-all duration-300"
              ></div>
            </div>
          </div>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {step === 1 && (
            <div className={cn("flex flex-col gap-2")}>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="mcp@example.com"
                disabled={isLoading}
                autoFocus
                value={formData.email}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    e.nativeEvent.isComposing === false
                  ) {
                    successEmailStep();
                  }
                }}
                onChange={(e) => setFormData({ email: e.target.value })}
                required
              />
            </div>
          )}
          {step === 2 && (
            <div className={cn("flex flex-col gap-2")}>
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Cgoing"
                disabled={isLoading}
                autoFocus
                value={formData.name}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    e.nativeEvent.isComposing === false
                  ) {
                    successNameStep();
                  }
                }}
                onChange={(e) => setFormData({ name: e.target.value })}
                required
              />
            </div>
          )}
          {step === 3 && (
            <div className={cn("flex flex-col gap-2")}>
              <div className="flex items-center">
                <Label htmlFor="password">Password</Label>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="********"
                disabled={isLoading}
                autoFocus
                value={formData.password}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    e.nativeEvent.isComposing === false
                  ) {
                    successPasswordStep();
                  }
                }}
                onChange={(e) => setFormData({ password: e.target.value })}
                required
              />
            </div>
          )}
          <p className="text-muted-foreground text-xs mb-6">
            {steps[step - 1]}
          </p>
          {/* Only the last step submits, so that is the only one that needs a
              token — and rendering it earlier would let it expire mid-flow. */}
          {step === 3 && <div className="mb-6">{captcha.widget}</div>}
          <div className="flex flex-row-reverse gap-2">
            <Button
              tabIndex={0}
              disabled={isLoading || (step === 3 && !captcha.ready)}
              className="w-1/2"
              onClick={() => {
                if (step === 1) successEmailStep();
                if (step === 2) successNameStep();
                if (step === 3) successPasswordStep();
              }}
            >
              {step === 3 ? t("Auth.SignUp.createAccount") : t("Common.next")}
              {isLoading && <Loader className="size-4 ml-2" />}
            </Button>
            <Button
              tabIndex={step === 1 ? -1 : 0}
              disabled={isLoading || step === 1}
              className={cn(step === 1 && "invisible", "w-1/2")}
              variant="ghost"
              onClick={backStep}
            >
              <ChevronLeft className="size-4" />
              {t("Common.back")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

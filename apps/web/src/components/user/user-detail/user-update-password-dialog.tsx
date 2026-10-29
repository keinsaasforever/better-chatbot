import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "ui/alert-dialog";
import { AlertDialogHeader } from "ui/alert-dialog";
import { useActionState, useState } from "react";
import { toast } from "sonner";
import { SubmitButton } from "./user-submit-button";
import Form from "next/form";
import { updateUserPasswordAction } from "@/app/api/user/actions";
import {
  UpdateUserPasswordActionState,
  UpdateUserPasswordError,
} from "@/app/api/user/validations";
import {
  passwordRegexPattern,
  passwordRequirementsText,
} from "lib/validations/password";

import { Input } from "ui/input";
import { useProfileTranslations } from "@/hooks/use-profile-translations";
import { useTranslations } from "next-intl";

export function UpdateUserPasswordDialog({
  children,
  userId,
  currentUserId,
  onReset,
  disabled,
  view,
}: {
  children: React.ReactNode;
  userId: string;
  currentUserId: string;
  onReset?: () => void;
  disabled?: boolean;
  view?: "admin" | "user";
}) {
  const { t } = useProfileTranslations(view);
  const tCommon = useTranslations("Common");
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [errorMessage, setErrorMessage] = useState<null | string>(null);

  const isCurrentUser = userId === currentUserId;

  const [_, resetPasswordFormAction, isPending] = useActionState<
    UpdateUserPasswordActionState,
    FormData
  >(async (_prevState, formData) => {
    const result = await updateUserPasswordAction({}, formData);
    setErrorMessage(null);
    if (result?.success) {
      setShowResetPasswordDialog(false);
      onReset?.();
    } else {
      const errorMsg = result?.message || t("failedToUpdatePassword");
      setErrorMessage(errorMsg);
      toast.error(errorMsg);
    }
    return result;
  }, {});
  return (
    <AlertDialog
      open={showResetPasswordDialog}
      onOpenChange={(open) => {
        setShowResetPasswordDialog(open);
        if (!open) {
          setErrorMessage(null);
        }
      }}
    >
      <AlertDialogTrigger asChild disabled={disabled}>
        {children}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("updatePasswordTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("changeUserPassword")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Form action={resetPasswordFormAction}>
          <input type="hidden" name="userId" value={userId} />
          <input
            type="hidden"
            name="isCurrentUser"
            value={String(isCurrentUser)}
          />
          <div className="space-y-4 my-4">
            {isCurrentUser && (
              <Input
                type="password"
                name="currentPassword"
                data-testid="current-password-input"
                placeholder={t("currentPassword")}
                required
              />
            )}
            <Input
              type="password"
              name="newPassword"
              data-testid="new-password-input"
              placeholder={t("newPasswordPlaceholder")}
              pattern={passwordRegexPattern}
              minLength={8}
              maxLength={20}
              required
              onFocus={() => setErrorMessage(null)}
              className={errorMessage ? "border-red-500" : ""}
              title={passwordRequirementsText}
            />
            <Input
              type="password"
              name="confirmPassword"
              data-testid="confirm-password-input"
              placeholder={t("confirmPassword")}
              pattern={passwordRegexPattern}
              minLength={8}
              maxLength={20}
              required
              onFocus={() => setErrorMessage(null)}
              className={
                errorMessage === UpdateUserPasswordError.PASSWORD_MISMATCH
                  ? "border-red-500"
                  : ""
              }
              title={passwordRequirementsText}
            />
            {errorMessage && (
              <p className="text-red-500 text-sm">{errorMessage}</p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setShowResetPasswordDialog(false)}
              disabled={isPending}
              type="button"
            >
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <SubmitButton
                variant="default"
                data-testid="update-password-submit-button"
              >
                {t("updatePasswordButton")}
              </SubmitButton>
            </AlertDialogAction>
          </AlertDialogFooter>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

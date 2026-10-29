import { deleteUserAction } from "@/app/api/user/actions";
import { DeleteUserActionState } from "@/app/api/user/validations";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "ui/alert-dialog";
import { SubmitButton } from "./user-submit-button";
import { BasicUserWithLastLogin } from "app-types/user";
import { useActionState, useState } from "react";
import Form from "next/form";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Input } from "ui/input";
import { useTranslations } from "next-intl";
import { useProfileTranslations } from "@/hooks/use-profile-translations";

export function UserDeleteDialog({
  user,
  children,
  view,
}: {
  user: BasicUserWithLastLogin;
  children?: React.ReactNode;
  view?: "admin" | "user";
}) {
  const router = useRouter();
  const { t } = useProfileTranslations(view);
  const tCommon = useTranslations("Common");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [_, deleteFormAction] = useActionState<DeleteUserActionState, FormData>(
    async (_prevState, formData) => {
      const result = await deleteUserAction({}, formData);

      if (result?.success) {
        router.replace(result.redirect || "/admin");
        setShowDeleteDialog(false);
      } else {
        toast.error(result?.message || t("failedToDeleteUser"));
      }
      return result;
    },
    {},
  );
  return (
    <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            ⚠️ {t("deleteUserTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>{t("deleteUserDescription", { name: user.name })}</p>

              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive mb-2">
                  {t("actionWillPermanently")}
                </p>
                <ul className="text-sm text-destructive/90 space-y-1">
                  <li>• {t("deleteAllUserData")}</li>
                  <li>• {t("removeAllFiles")}</li>
                  <li>• {t("revokeAllAccess")}</li>
                  <li>• {t("cannotBeUndone")}</li>
                </ul>
              </div>

              <div>
                <p className="text-sm font-medium text-destructive mb-2">
                  {t("typeNameToConfirm", { name: user.name })}
                </p>
                <Input
                  placeholder={t("typeToConfirm", { name: user.name })}
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  className="border-destructive/30 focus:border-destructive"
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              setShowDeleteDialog(false);
              setConfirmName("");
            }}
          >
            {tCommon("cancel")}
          </AlertDialogCancel>
          <Form action={deleteFormAction}>
            <input type="hidden" name="userId" value={user.id} />
            <AlertDialogAction asChild>
              <SubmitButton
                variant="destructive"
                disabled={confirmName !== user.name}
              >
                {t("deleteUser")}
              </SubmitButton>
            </AlertDialogAction>
          </Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

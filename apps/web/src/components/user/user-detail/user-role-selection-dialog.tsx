import { SubmitButton } from "./user-submit-button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogTrigger,
} from "ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "ui/radio-group";
import { Label } from "ui/label";
import { UserRoleNames, userRolesInfo } from "app-types/roles";
import { BasicUserWithLastLogin } from "app-types/user";
import { useActionState, useState } from "react";
import { toast } from "sonner";
import { updateUserRolesAction } from "@/app/api/admin/actions";
import { UpdateUserRoleActionState } from "@/app/api/admin/validations";
import Form from "next/form";
import { useTranslations } from "next-intl";
import { useProfileTranslations } from "@/hooks/use-profile-translations";

export function UserRoleSelector({
  children,
  user,
  onRoleChange,
  open,
  onOpenChange,
  view,
}: {
  children?: React.ReactNode;
  user: Pick<BasicUserWithLastLogin, "id" | "name" | "role">;
  onRoleChange: (updatedUser: Pick<BasicUserWithLastLogin, "role">) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  view?: "admin" | "user";
}) {
  const { t } = useProfileTranslations(view);
  const tCommon = useTranslations("Common");
  const [_, roleFormAction, isPending] = useActionState<
    UpdateUserRoleActionState,
    FormData
  >(async (_prevState, formData) => {
    const result = await updateUserRolesAction({}, formData);
    if (result?.success && result.user) {
      onRoleChange(result.user);
      const closeDialog = () => {
        if (onOpenChange) {
          onOpenChange(false);
        } else {
          setShowRoleDialog(false);
        }
      };
      closeDialog();
    } else {
      toast.error(result?.message || t("failedToUpdateRole"));
      const closeDialog = () => {
        if (onOpenChange) {
          onOpenChange(false);
        } else {
          setShowRoleDialog(false);
        }
      };
      closeDialog();
    }
    return result;
  }, {});
  const [showRoleDialog, setShowRoleDialog] = useState(false);

  const isOpen = open !== undefined ? open : showRoleDialog;
  const handleOpenChange = onOpenChange || setShowRoleDialog;

  return (
    <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
      {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
      <AlertDialogContent>
        <Form action={roleFormAction}>
          <input type="hidden" name="userId" value={user.id} />

          <AlertDialogHeader>
            <AlertDialogTitle>{t("changeUserRoles")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("selectRolesFor", { name: user.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="my-4 space-y-3">
            <RadioGroup
              name="role"
              defaultValue={user.role ?? undefined}
              onValueChange={(value) => {
                onRoleChange({ role: value as UserRoleNames });
              }}
            >
              {Object.entries(userRolesInfo).map(([role, info]) => (
                <div key={role} className="flex items-start space-x-3">
                  <RadioGroupItem
                    value={role}
                    id={role}
                    disabled={isPending}
                    className="data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                    data-testid={`role-radio-${role}`}
                  />
                  <div className="leading-none flex flex-col w-full">
                    <Label
                      htmlFor={role}
                      className="flex flex-col w-full cursor-pointer"
                    >
                      <span className="w-full flex-1 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-start">
                        {info.label}
                      </span>
                      <span className="w-full flex-1 text-sm text-muted-foreground text-start">
                        {info.description}
                      </span>
                    </Label>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 pt-6">
            <AlertDialogCancel
              disabled={isPending}
              type="button"
              onClick={() => handleOpenChange(false)}
            >
              {tCommon("cancel")}
            </AlertDialogCancel>
            <SubmitButton>{t("updateRole")}</SubmitButton>
          </div>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

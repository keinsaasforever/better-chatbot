"use client";

import { useState, useActionState, useMemo } from "react";
import { Badge } from "ui/badge";
import { cn } from "lib/utils";
import { BasicUserWithLastLogin } from "app-types/user";
import { toast } from "sonner";
import { updateUserBanStatusAction } from "@/app/api/admin/actions";
import { UpdateUserBanStatusActionState } from "@/app/api/admin/validations";
import { useProfileTranslations } from "@/hooks/use-profile-translations";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { Edit2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogTrigger,
} from "ui/alert-dialog";
import Form from "next/form";
import { SubmitButton } from "./user-submit-button";

export function UserStatusBadge({
  user,
  onStatusChange,
  currentUserId,
  disabled = false,
  showClickable = true,
  view,
}: {
  user: BasicUserWithLastLogin;
  onStatusChange?: (user: BasicUserWithLastLogin) => void;
  currentUserId?: string;
  disabled?: boolean;
  showClickable?: boolean;
  view?: "admin" | "user";
}) {
  const { t, tCommon } = useProfileTranslations(view);
  const tGlobalCommon = useTranslations("Common");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const [_, banStatusAction, isPending] = useActionState<
    UpdateUserBanStatusActionState,
    FormData
  >(async (_prevState, formData) => {
    const result = await updateUserBanStatusAction({}, formData);
    if (result?.success && result.user) {
      onStatusChange?.(result.user);
      setShowConfirmDialog(false);
    } else {
      toast.error(result?.message || t("failedToUpdateUserStatus"));
      setShowConfirmDialog(false);
    }
    return result;
  }, {});

  const canModify = useMemo(() => {
    return showClickable && !disabled && currentUserId !== user.id;
  }, [showClickable, disabled, currentUserId, user.id]);
  const willBan = !user.banned;

  const renderBadge = () => {
    const badgeElement = user.banned ? (
      <Badge
        variant="destructive"
        data-testid="status-badge-banned"
        className={cn(
          canModify &&
            "cursor-pointer hover:bg-destructive/80 transition-colors",
          canModify && "flex items-center gap-1",
        )}
      >
        {tCommon("banned")}
        {canModify && <Edit2 className="size-2.5!" />}
      </Badge>
    ) : (
      <Badge
        variant="secondary"
        data-testid="status-badge-active"
        className={cn(
          canModify && "cursor-pointer hover:bg-muted transition-colors",
          canModify && "flex items-center gap-1",
        )}
      >
        {tCommon("active")}
        {canModify && <Edit2 className="size-2.5!" />}
      </Badge>
    );

    if (canModify) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{badgeElement}</TooltipTrigger>
          <TooltipContent>
            {user.banned ? t("clickToUnbanUser") : t("clickToBanUser")}
          </TooltipContent>
        </Tooltip>
      );
    }

    return badgeElement;
  };

  return (
    <>
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        {canModify ? (
          <AlertDialogTrigger>{renderBadge()}</AlertDialogTrigger>
        ) : (
          renderBadge()
        )}
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {willBan ? t("banUser") : t("unbanUser")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {willBan
                ? t("banUserConfirmation", { name: user.name })
                : t("unbanUserConfirmation", { name: user.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Form action={banStatusAction}>
            <input type="hidden" name="userId" value={user.id} />
            <input
              type="hidden"
              name="banned"
              value={user.banned ? "true" : "false"}
            />
            <div className="flex justify-end gap-2">
              <AlertDialogCancel
                disabled={isPending}
                onClick={(e) => {
                  e.preventDefault();
                  setShowConfirmDialog(false);
                }}
              >
                {tGlobalCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isPending}
                className={
                  willBan ? "bg-destructive hover:bg-destructive/90" : ""
                }
                asChild
              >
                <SubmitButton
                  className={
                    willBan ? "bg-destructive hover:bg-destructive/90" : ""
                  }
                >
                  {isPending
                    ? willBan
                      ? t("banning")
                      : t("unbanning")
                    : willBan
                      ? t("banUser")
                      : t("unbanUser")}
                </SubmitButton>
              </AlertDialogAction>
            </div>
          </Form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

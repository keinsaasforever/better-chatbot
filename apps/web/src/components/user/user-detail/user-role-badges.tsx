import { Badge } from "ui/badge";
import { userRolesInfo } from "app-types/roles";
import { UserRoleNames } from "app-types/roles";
import { BasicUserWithLastLogin } from "app-types/user";
import { cn } from "lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { Edit2 } from "lucide-react";
import { useProfileTranslations } from "@/hooks/use-profile-translations";

export function UserRoleBadges({
  user,
  showBanned = false,
  className,
  onRoleClick,
  onBanClick,
  disabled = false,
  view,
}: {
  user: Pick<BasicUserWithLastLogin, "role" | "banned">;
  showBanned?: boolean;
  className?: string;
  view?: "admin" | "user";
  onRoleClick?: () => void;
  onBanClick?: () => void;
  disabled?: boolean;
}) {
  const { t, tCommon } = useProfileTranslations(view);
  return (
    <div
      className={cn("mt-3 flex flex-wrap items-center gap-2", className)}
      data-testid="user-role-badges"
    >
      {user.role?.split(",").map((role) => {
        const isClickable = onRoleClick && !disabled;
        const badgeContent = (
          <Badge
            key={role}
            variant="secondary"
            className={cn(
              "text-xs",
              isClickable &&
                "cursor-pointer hover:bg-secondary/80 transition-colors",
              isClickable && "flex items-center gap-1",
            )}
            data-testid={`role-badge-${role.toLowerCase()}`}
            onClick={isClickable ? onRoleClick : undefined}
          >
            {userRolesInfo[role as UserRoleNames]?.label || role}
            {isClickable && <Edit2 className="size-2.5!" />}
          </Badge>
        );

        if (isClickable) {
          return (
            <Tooltip key={role}>
              <TooltipTrigger asChild>{badgeContent}</TooltipTrigger>
              <TooltipContent>{t("clickToChangeUserRole")}</TooltipContent>
            </Tooltip>
          );
        }

        return badgeContent;
      })}
      {showBanned && user.banned && (
        <Badge
          variant="destructive"
          data-testid="user-banned-badge"
          className={cn(
            onBanClick &&
              !disabled &&
              "cursor-pointer hover:bg-destructive/80 transition-colors",
          )}
          onClick={onBanClick && !disabled ? onBanClick : undefined}
        >
          {tCommon("banned")}
        </Badge>
      )}
    </div>
  );
}

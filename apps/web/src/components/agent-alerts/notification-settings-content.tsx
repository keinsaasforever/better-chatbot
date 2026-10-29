"use client";

import { useObjectState } from "@/hooks/use-object-state";
import { isDesktop } from "@keinsaas/mcp-core/is-desktop";
import type { UserPreferences } from "app-types/user";
import { fetcher } from "lib/utils";
import {
  resolveNotificationPrefs,
  NOTIFICATION_PREFS_DEFAULTS,
} from "@/lib/agent-alerts/resolve-notification-prefs";
import { setCachedNotificationPrefs } from "@/lib/agent-alerts/prefs-cache";
import {
  requestBrowserNotificationPermission,
  sendTestAgentAlert,
} from "@/lib/agent-alerts/maybe-notify-agent-alert";
import { registerWebPushSubscription } from "@/lib/push/register-web-push";
import { Bell, Loader } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "ui/button";
import { Label } from "ui/label";
import { Skeleton } from "ui/skeleton";
import { Switch } from "ui/switch";

type NotificationPrefs = NonNullable<UserPreferences["notifications"]>;

export function NotificationSettingsContent() {
  const t = useTranslations("Chat.ChatPreferences.notificationSettings");
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [isSaving, setIsSaving] = useState(false);

  const { data, isLoading, mutate } = useSWR<UserPreferences>(
    "/api/user/preferences",
    fetcher,
    { fallback: {} },
  );

  const [notifications, setNotifications] = useObjectState<NotificationPrefs>(
    NOTIFICATION_PREFS_DEFAULTS,
  );

  useEffect(() => {
    const resolved = resolveNotificationPrefs(data?.notifications);
    setNotifications(resolved);
    setCachedNotificationPrefs(resolved);
  }, [data?.notifications, setNotifications]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  const saveNotifications = useCallback(
    async (next: NotificationPrefs) => {
      setIsSaving(true);
      try {
        const merged: UserPreferences = {
          ...(data ?? {}),
          notifications: next,
        };
        const response = await fetch("/api/user/preferences", {
          method: "PUT",
          body: JSON.stringify(merged),
        });
        if (!response.ok) {
          throw new Error("Failed to save");
        }
        setCachedNotificationPrefs(next);
        await mutate();
      } catch {
        toast.error(t("saveFailed"));
      } finally {
        setIsSaving(false);
      }
    },
    [data, mutate, t],
  );

  const updatePref = useCallback(
    (patch: Partial<NotificationPrefs>) => {
      const next = { ...notifications, ...patch };
      setNotifications(next);
      void saveNotifications(next);
    },
    [notifications, saveNotifications, setNotifications],
  );

  const handleEnablePermission = async () => {
    const result = await requestBrowserNotificationPermission();
    setPermission(result);
    if (result === "granted") {
      await registerWebPushSubscription();
    } else if (result === "denied") {
      toast.error(t("permissionDenied"));
    }
  };

  const handleTest = () => {
    sendTestAgentAlert();
  };

  const permissionLabel =
    permission === "unsupported"
      ? t("permissionUnsupported")
      : isDesktop
        ? t("permissionDesktop")
        : permission === "granted"
          ? t("permissionGrantedStatus")
          : permission === "denied"
            ? t("permissionDeniedStatus")
            : t("permissionDefaultStatus");

  return (
    <div className="flex flex-col">
      <h3 className="text-xl font-semibold">{t("title")}</h3>
      <p className="text-sm text-muted-foreground py-2 pb-6">
        {t("description")}
      </p>

      <div className="flex flex-col gap-5">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-10" />
          ))
        ) : (
          <>
            <PreferenceRow
              label={t("desktopAlerts")}
              description={t("desktopAlertsDescription")}
              checked={notifications.desktopEnabled}
              disabled={isSaving}
              onCheckedChange={(checked) =>
                updatePref({ desktopEnabled: checked })
              }
            />
            <PreferenceRow
              label={t("onlyWhenAway")}
              description={t("onlyWhenAwayDescription")}
              checked={notifications.onlyWhenAway}
              disabled={isSaving}
              onCheckedChange={(checked) =>
                updatePref({ onlyWhenAway: checked })
              }
            />
            <PreferenceRow
              label={t("hideTaskDetails")}
              description={t("hideTaskDetailsDescription")}
              checked={notifications.hideTaskDetails}
              disabled={isSaving}
              onCheckedChange={(checked) =>
                updatePref({ hideTaskDetails: checked })
              }
            />
            <PreferenceRow
              label={t("weeklyReminders")}
              description={t("weeklyRemindersDescription")}
              checked={notifications.weeklyEngagementEnabled}
              disabled={isSaving}
              onCheckedChange={(checked) =>
                updatePref({ weeklyEngagementEnabled: checked })
              }
            />
          </>
        )}

        <div className="rounded-lg border bg-muted/20 p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <Bell className="size-4 mt-0.5 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium">{t("permissionTitle")}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {permissionLabel}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isDesktop && permission === "default" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleEnablePermission}
                disabled={isSaving}
              >
                {t("enableNotifications")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleTest}
              disabled={isSaving}
            >
              {t("sendTest")}
            </Button>
            {isSaving && <Loader className="size-4 animate-spin" />}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreferenceRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

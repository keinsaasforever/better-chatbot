"use client";

import {
  VoiceDeviceHistoryItem,
  VoiceDeviceSummary,
} from "app-types/voice-device";
import { cn } from "lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2Icon,
  CircleIcon,
  Clock3Icon,
  Loader2Icon,
  MicIcon,
  PlusIcon,
  RadioIcon,
  Trash2Icon,
  WifiIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Input } from "ui/input";
import { Label } from "ui/label";

type SetupStep = "intro" | "wifi" | "code" | "waiting";

type SetupStatus = {
  registrationId: string;
  registrationStatus: string;
  deviceId: string | null;
  displayName: string | null;
  connectionStatus: "online" | "offline" | "never_connected";
  lastSeenLabel: string | null;
  isOnline: boolean;
  isComplete: boolean;
};

const SETUP_STEPS: SetupStep[] = ["intro", "wifi", "code", "waiting"];

function ConnectionBadge({
  status,
  label,
}: {
  status: VoiceDeviceSummary["connectionStatus"];
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        status === "online" && "text-emerald-600",
        status === "offline" && "text-amber-600",
        status === "never_connected" && "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          status === "online" && "bg-emerald-500",
          status === "offline" && "bg-amber-500",
          status === "never_connected" && "bg-muted-foreground/50",
        )}
      />
      {label}
    </span>
  );
}

export function VoiceDeviceSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Chat.VoiceChat.Devices");
  const [devices, setDevices] = useState<VoiceDeviceSummary[]>([]);
  const [historyByDevice, setHistoryByDevice] = useState<
    Record<string, VoiceDeviceHistoryItem[]>
  >({});
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [view, setView] = useState<"list" | "setup">("list");
  const [setupStep, setSetupStep] = useState<SetupStep>("intro");
  const [displayName, setDisplayName] = useState("Atom EchoS3R");
  const [pairingCode, setPairingCode] = useState("");
  const [registrationId, setRegistrationId] = useState<string | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const resetSetup = useCallback(() => {
    stopPolling();
    setView("list");
    setSetupStep("intro");
    setPairingCode("");
    setRegistrationId(null);
    setSetupStatus(null);
    setDisplayName("Atom EchoS3R");
  }, [stopPolling]);

  const loadDevices = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/voice/devices");
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load devices");
      }
      const nextDevices = (payload.devices ?? []) as VoiceDeviceSummary[];
      setDevices(nextDevices);
      setHistoryByDevice({});

      if (nextDevices.length > 0) {
        setIsHistoryLoading(true);
        const histories = await Promise.all(
          nextDevices.map(async (device) => {
            const historyResponse = await fetch(
              `/api/voice/devices/history?deviceId=${encodeURIComponent(
                device.id,
              )}&limit=3`,
            );
            if (!historyResponse.ok) {
              return [device.id, []] as const;
            }
            const historyPayload = await historyResponse.json();
            return [
              device.id,
              (historyPayload.items ?? []) as VoiceDeviceHistoryItem[],
            ] as const;
          }),
        );
        setHistoryByDevice(Object.fromEntries(histories));
      }
    } catch (error: any) {
      toast.error(error.message || t("loadFailed"));
    } finally {
      setIsLoading(false);
      setIsHistoryLoading(false);
    }
  }, [t]);

  const pollSetupStatus = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(
          `/api/voice/devices/setup-status?registrationId=${encodeURIComponent(id)}`,
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load setup status");
        }
        setSetupStatus(payload);
        if (payload.isComplete) {
          stopPolling();
          await loadDevices();
        }
      } catch (error: any) {
        toast.error(error.message || t("setupStatusFailed"));
      }
    },
    [loadDevices, stopPolling, t],
  );

  useEffect(() => {
    if (!open) {
      resetSetup();
      return;
    }
    void loadDevices();
  }, [open, loadDevices, resetSetup]);

  useEffect(() => {
    if (view !== "setup" || setupStep !== "waiting" || !registrationId) {
      return;
    }
    void pollSetupStatus(registrationId);
    pollRef.current = window.setInterval(() => {
      void pollSetupStatus(registrationId);
    }, 3000);
    return () => stopPolling();
  }, [view, setupStep, registrationId, pollSetupStatus, stopPolling]);

  const claimDevice = async () => {
    const code = pairingCode.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      toast.error(t("invalidCode"));
      return;
    }

    setIsClaiming(true);
    try {
      const response = await fetch("/api/voice/devices/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          displayName: displayName.trim() || "Atom EchoS3R",
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to claim device");
      }
      setRegistrationId(payload.registrationId);
      setSetupStep("waiting");
    } catch (error: any) {
      toast.error(error.message || t("claimFailed"));
    } finally {
      setIsClaiming(false);
    }
  };

  const revokeDevice = async (deviceId: string) => {
    setRevokingId(deviceId);
    try {
      const response = await fetch("/api/voice/devices/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to revoke device");
      }
      await loadDevices();
    } catch (error: any) {
      toast.error(error.message || t("revokeFailed"));
    } finally {
      setRevokingId(null);
    }
  };

  const connectionLabel = (status: VoiceDeviceSummary["connectionStatus"]) => {
    if (status === "online") return t("statusOnline");
    if (status === "offline") return t("statusOffline");
    return t("statusNeverConnected");
  };

  const historyStatusLabel = (
    status: VoiceDeviceHistoryItem["actionStatus"],
  ) => {
    if (status === "executed") return t("historyExecuted");
    if (status === "failed") return t("historyFailed");
    if (status === "ignored") return t("historyIgnored");
    return t("historyStored");
  };

  const setupStepIndex = SETUP_STEPS.indexOf(setupStep);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetSetup();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {view === "list" ? t("title") : t("setupTitle")}
          </DialogTitle>
          <DialogDescription>
            {view === "list" ? t("description") : t("setupDescription")}
          </DialogDescription>
        </DialogHeader>

        {view === "list" ? (
          <div className="space-y-4">
            <Button
              className="w-full"
              onClick={() => {
                setView("setup");
                setSetupStep("intro");
              }}
            >
              <PlusIcon className="size-4 mr-2" />
              {t("addDevice")}
            </Button>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">{t("pairedDevices")}</p>
                {isLoading || isHistoryLoading ? (
                  <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                ) : null}
              </div>

              {devices.length === 0 && !isLoading ? (
                <p className="text-sm text-muted-foreground">{t("empty")}</p>
              ) : (
                <div className="space-y-2">
                  {devices.map((device) => (
                    <div key={device.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <RadioIcon className="size-4 shrink-0 text-muted-foreground" />
                            <p className="font-medium truncate">
                              {device.displayName}
                            </p>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {device.deviceType.replaceAll("_", " ")}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                            {device.status === "active" ? (
                              <ConnectionBadge
                                status={device.connectionStatus}
                                label={connectionLabel(device.connectionStatus)}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {t("statusRevoked")}
                              </span>
                            )}
                          </div>
                        </div>
                        {device.status === "active" ? (
                          <Button
                            variant="outline"
                            size="icon"
                            disabled={revokingId === device.id}
                            onClick={() => void revokeDevice(device.id)}
                          >
                            {revokingId === device.id ? (
                              <Loader2Icon className="size-4 animate-spin" />
                            ) : (
                              <Trash2Icon className="size-4" />
                            )}
                          </Button>
                        ) : null}
                      </div>

                      <div className="mt-3 border-t pt-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <MicIcon className="size-3.5 text-muted-foreground" />
                            <p className="text-xs font-medium">
                              {t("historyTitle")}
                            </p>
                          </div>
                          {isHistoryLoading ? (
                            <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
                          ) : null}
                        </div>
                        {(historyByDevice[device.id] ?? []).length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            {t("historyEmpty")}
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {(historyByDevice[device.id] ?? []).map((item) => (
                              <div key={item.id} className="space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span
                                    className={cn(
                                      "text-xs",
                                      item.actionStatus === "executed" &&
                                        "text-emerald-600",
                                      item.actionStatus === "failed" &&
                                        "text-destructive",
                                      item.actionStatus === "ignored" &&
                                        "text-muted-foreground",
                                    )}
                                  >
                                    {historyStatusLabel(item.actionStatus)}
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                    <Clock3Icon className="size-3" />
                                    {formatDistanceToNow(
                                      new Date(item.createdAt),
                                      {
                                        addSuffix: true,
                                      },
                                    )}
                                  </span>
                                </div>
                                <p className="line-clamp-2 text-sm">
                                  {item.text}
                                </p>
                                {item.message ? (
                                  <p className="line-clamp-2 text-xs text-muted-foreground">
                                    {item.message}
                                  </p>
                                ) : null}
                                {item.actions.length > 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    {t("historyActionsCount", {
                                      count: item.actions.length,
                                    })}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {SETUP_STEPS.map((step, index) => {
                const isComplete = index < setupStepIndex;
                const isActive = index === setupStepIndex;
                return (
                  <div key={step} className="flex items-center gap-2 flex-1">
                    {isComplete ? (
                      <CheckCircle2Icon className="size-4 text-emerald-600 shrink-0" />
                    ) : (
                      <CircleIcon
                        className={cn(
                          "size-4 shrink-0",
                          isActive
                            ? "text-primary"
                            : "text-muted-foreground/50",
                        )}
                      />
                    )}
                    {index < SETUP_STEPS.length - 1 ? (
                      <div
                        className={cn(
                          "h-px flex-1",
                          isComplete ? "bg-emerald-600/40" : "bg-border",
                        )}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>

            {setupStep === "intro" ? (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="font-medium">{t("stepIntroTitle")}</p>
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>{t("stepIntro1")}</li>
                  <li>{t("stepIntro2")}</li>
                  <li>{t("stepIntro3")}</li>
                </ol>
              </div>
            ) : null}

            {setupStep === "wifi" ? (
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <WifiIcon className="size-4 text-muted-foreground" />
                  <p className="font-medium">{t("stepWifiTitle")}</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("stepWifiHint")}
                </p>
                <p className="text-sm font-mono rounded-md bg-muted/50 p-3">
                  Navigator-Echo-XXXX
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("stepWifiPortal")}
                </p>
              </div>
            ) : null}

            {setupStep === "code" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="voice-device-name">{t("displayName")}</Label>
                  <Input
                    id="voice-device-name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder={t("displayNamePlaceholder")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="voice-device-code">{t("enterCode")}</Label>
                  <Input
                    id="voice-device-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={pairingCode}
                    onChange={(event) =>
                      setPairingCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                    placeholder="123456"
                    className="text-2xl tracking-[0.3em] text-center font-semibold"
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("enterCodeHint")}
                  </p>
                </div>
              </div>
            ) : null}

            {setupStep === "waiting" ? (
              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  {setupStatus?.isComplete ? (
                    <CheckCircle2Icon className="size-5 text-emerald-600" />
                  ) : (
                    <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
                  )}
                  <p className="font-medium">
                    {setupStatus?.isComplete
                      ? t("setupComplete")
                      : t("waitingForDevice")}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {setupStatus?.isComplete
                    ? t("setupCompleteHint")
                    : t("waitingForDeviceHint")}
                </p>
                {setupStatus ? (
                  <ConnectionBadge
                    status={setupStatus.connectionStatus}
                    label={
                      setupStatus.isOnline
                        ? t("statusOnline")
                        : setupStatus.connectionStatus === "never_connected"
                          ? t("statusNeverConnected")
                          : t("statusOffline")
                    }
                  />
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  if (setupStep === "intro") {
                    resetSetup();
                    return;
                  }
                  const prev = SETUP_STEPS[setupStepIndex - 1];
                  if (prev) setSetupStep(prev);
                }}
              >
                {setupStep === "intro" ? t("cancel") : t("back")}
              </Button>

              {setupStep === "waiting" && setupStatus?.isComplete ? (
                <Button onClick={() => resetSetup()}>{t("done")}</Button>
              ) : setupStep === "code" ? (
                <Button
                  disabled={isClaiming || pairingCode.length !== 6}
                  onClick={() => void claimDevice()}
                >
                  {isClaiming ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    t("linkDevice")
                  )}
                </Button>
              ) : setupStep !== "waiting" ? (
                <Button
                  onClick={() => {
                    const next = SETUP_STEPS[setupStepIndex + 1];
                    if (next) setSetupStep(next);
                  }}
                >
                  {t("continue")}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

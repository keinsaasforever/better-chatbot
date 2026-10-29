"use client";

import {
  OPENAI_VOICE_PRESETS,
  resolveOpenAIVoicePreset,
} from "lib/ai/speech/open-ai/voice-constants";
import {
  DEFAULT_VOICE_SETTINGS,
  VOICE_EAGERNESS_OPTIONS,
  VOICE_NOISE_REDUCTION_OPTIONS,
  VOICE_PREFIX_PADDING_OPTIONS_MS,
  VOICE_SILENCE_DURATION_OPTIONS_MS,
  VOICE_SPEED_OPTIONS,
  VOICE_THRESHOLD_OPTIONS,
  type VoiceSessionConfirmation,
  type VoiceSettings,
  normalizeVoiceSettings,
} from "lib/ai/speech/open-ai/voice-settings";
import { RadioIcon, RotateCcwIcon, Settings2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "ui/button";
import { Label } from "ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import { Switch } from "ui/switch";

type VoiceSettingsPopoverProps = {
  /** Raw store values; validated here the same way the hook does. */
  voice?: string;
  settings?: unknown;
  onChange: (patch: { voice?: string; settings?: VoiceSettings }) => void;
  disabled: boolean;
  isActive: boolean;
  /** The preset the live session speaks with. */
  sessionVoice?: string;
  settingsPending: boolean;
  confirmation?: VoiceSessionConfirmation;
  onOpenDevices: () => void;
};

/**
 * Voice, speed, interruptions and end-of-turn detection for the realtime
 * voice chat. Everything except the voice applies to a live session too: the
 * hook sends it as a `session-update` between two answers. A new voice needs a
 * new session (OpenAI refuses a voice change once the model has spoken).
 */
export function VoiceSettingsPopover({
  voice,
  settings: rawSettings,
  onChange,
  disabled,
  isActive,
  sessionVoice,
  settingsPending,
  confirmation,
  onOpenDevices,
}: VoiceSettingsPopoverProps) {
  const t = useTranslations("Chat.VoiceChat.Settings");
  const tDevices = useTranslations("Chat.VoiceChat.Devices");
  const id = useId();
  const presetId = resolveOpenAIVoicePreset(voice).id;
  const settings = normalizeVoiceSettings(rawSettings);
  const update = (patch: Partial<VoiceSettings>) =>
    onChange({ settings: { ...settings, ...patch } });
  const voiceAppliesNextSession =
    isActive && sessionVoice != null && sessionVoice !== presetId;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={"ghost"}
          size={"icon"}
          disabled={disabled}
          aria-label={t("title")}
        >
          <Settings2Icon className="text-foreground size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="w-80 max-h-[80vh] overflow-y-auto space-y-4"
      >
        <div className="flex items-center justify-between">
          <p className="font-semibold text-sm">{t("title")}</p>
          <Button
            variant={"ghost"}
            size={"sm"}
            className="h-7 gap-1 text-xs"
            onClick={() => onChange({ settings: DEFAULT_VOICE_SETTINGS })}
          >
            <RotateCcwIcon className="size-3" />
            {t("reset")}
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-voice`}>{t("voice")}</Label>
          <Select
            value={presetId}
            onValueChange={(value) => onChange({ voice: value })}
          >
            <SelectTrigger id={`${id}-voice`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPENAI_VOICE_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {voiceAppliesNextSession && (
            <p className="text-xs text-muted-foreground">
              {t("voiceNextSession")}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-speed`}>{t("speed")}</Label>
          <Select
            value={String(settings.speed)}
            onValueChange={(value) => update({ speed: Number(value) })}
          >
            <SelectTrigger id={`${id}-speed`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOICE_SPEED_OPTIONS.map((speed) => (
                <SelectItem key={speed} value={String(speed)}>
                  {t("speedValue", { value: speed })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("speedHint")}</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`${id}-interrupt`}>{t("interruptions")}</Label>
            <Switch
              id={`${id}-interrupt`}
              checked={settings.allowInterruptions}
              onCheckedChange={(checked) =>
                update({ allowInterruptions: checked })
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {settings.allowInterruptions
              ? t("interruptionsOnHint")
              : t("interruptionsOffHint")}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-vad`}>{t("turnDetection")}</Label>
          <Select
            value={settings.turnDetection}
            onValueChange={(value) =>
              update({ turnDetection: value as VoiceSettings["turnDetection"] })
            }
          >
            <SelectTrigger id={`${id}-vad`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="semantic">{t("turnSemantic")}</SelectItem>
              <SelectItem value="server">{t("turnServer")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {settings.turnDetection === "semantic" ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-eagerness`}>{t("eagerness")}</Label>
            <Select
              value={settings.eagerness}
              onValueChange={(value) =>
                update({ eagerness: value as VoiceSettings["eagerness"] })
              }
            >
              <SelectTrigger id={`${id}-eagerness`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOICE_EAGERNESS_OPTIONS.map((eagerness) => (
                  <SelectItem key={eagerness} value={eagerness}>
                    {t(`eagernessOption.${eagerness}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-silence`}>{t("silenceDuration")}</Label>
              <Select
                value={String(settings.silenceDurationMs)}
                onValueChange={(value) =>
                  update({ silenceDurationMs: Number(value) })
                }
              >
                <SelectTrigger id={`${id}-silence`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_SILENCE_DURATION_OPTIONS_MS.map((ms) => (
                    <SelectItem key={ms} value={String(ms)}>
                      {t("milliseconds", { value: ms })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-threshold`}>{t("threshold")}</Label>
              <Select
                value={String(settings.threshold)}
                onValueChange={(value) => update({ threshold: Number(value) })}
              >
                <SelectTrigger id={`${id}-threshold`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_THRESHOLD_OPTIONS.map((threshold) => (
                    <SelectItem key={threshold} value={String(threshold)}>
                      {t("thresholdValue", { value: threshold })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-prefix`}>{t("prefixPadding")}</Label>
              <Select
                value={String(settings.prefixPaddingMs)}
                onValueChange={(value) =>
                  update({ prefixPaddingMs: Number(value) })
                }
              >
                <SelectTrigger id={`${id}-prefix`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_PREFIX_PADDING_OPTIONS_MS.map((ms) => (
                    <SelectItem key={ms} value={String(ms)}>
                      {t("milliseconds", { value: ms })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-noise`}>{t("noiseReduction")}</Label>
          <Select
            value={settings.noiseReduction}
            onValueChange={(value) =>
              update({
                noiseReduction: value as VoiceSettings["noiseReduction"],
              })
            }
          >
            <SelectTrigger id={`${id}-noise`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOICE_NOISE_REDUCTION_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`noiseOption.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isActive && (
          <p className="text-xs text-muted-foreground border-t pt-3">
            {settingsPending
              ? t("statusPending")
              : confirmation?.status === "confirmed"
                ? t("statusConfirmed")
                : confirmation?.status === "mismatch"
                  ? t("statusMismatch", {
                      fields: confirmation.fields.join(", "),
                    })
                  : confirmation?.status === "unverifiable"
                    ? t("statusUnverifiable")
                    : t("statusWaiting")}
          </p>
        )}

        <Button
          variant={"secondary"}
          size={"sm"}
          className="w-full gap-2"
          onClick={onOpenDevices}
        >
          <RadioIcon className="size-3.5" />
          {tDevices("menuLabel")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

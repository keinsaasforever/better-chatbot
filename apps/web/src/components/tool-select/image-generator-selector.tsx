"use client";

import {
  AUTO_IMAGE_MODEL_ID,
  SELECTABLE_IMAGE_MODELS,
} from "lib/ai/image/image-models";
import { ImagesIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "ui/dropdown-menu";
import { GeminiIcon } from "ui/gemini-icon";
import { OpenAIIcon } from "ui/openai-icon";

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === "openai") return <OpenAIIcon className="mr-2 size-4" />;
  if (provider === "google") return <GeminiIcon className="mr-2 size-4" />;
  return <ImagesIcon className="mr-2 size-4" />;
}

export function ImageGeneratorSelector({
  onGenerateImage,
  modelInfo,
}: {
  onGenerateImage?: (model?: string) => void;
  modelInfo?: { isToolCallUnsupported?: boolean };
}) {
  const t = useTranslations("Chat");

  return (
    <DropdownMenuGroup>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="text-xs flex items-center gap-2 font-semibold cursor-pointer">
          <ImagesIcon className="size-3.5" />
          {t("generateImage")}
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent className="w-[var(--radix-popper-available-width)] md:w-auto">
            {/* The app picks: an edit of an uploaded photo goes to an
                identity-preserving model, a fresh prompt to the cheapest one.
                Manual picks below are for people who know the models. */}
            <DropdownMenuItem
              disabled={modelInfo?.isToolCallUnsupported}
              onClick={() => onGenerateImage?.(AUTO_IMAGE_MODEL_ID)}
              className="cursor-pointer"
            >
              <SparklesIcon className="mr-2 size-4" />
              <span className="flex flex-col">
                <span>{t("imageModelAuto")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("imageModelAutoHint")}
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {SELECTABLE_IMAGE_MODELS.map((model) => (
              <DropdownMenuItem
                key={model.id}
                disabled={modelInfo?.isToolCallUnsupported}
                onClick={() => onGenerateImage?.(model.id)}
                className="cursor-pointer"
              >
                <ProviderIcon provider={model.provider} />
                {model.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </DropdownMenuGroup>
  );
}

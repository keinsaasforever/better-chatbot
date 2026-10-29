"use client";
import EmojiPicker, { Theme } from "emoji-picker-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "ui/dialog";
import { Input } from "ui/input";
import { Textarea } from "ui/textarea";
import { Label } from "ui/label";
import { Button } from "ui/button";
import { useTheme } from "next-themes";
import { useObjectState } from "@/hooks/use-object-state";
import { requireCredits } from "@/lib/billing/require-credits";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";

import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Loader } from "lucide-react";
import { safe } from "ts-safe";
import { z } from "zod";

import { DBWorkflow, WorkflowIcon } from "app-types/workflow";
import { handleErrorWithToast } from "ui/shared-toast";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn, createDebounce } from "lib/utils";
import { mutate } from "swr";
import { useTranslations } from "next-intl";
import { BACKGROUND_COLORS } from "lib/const";

const colorUpdateDebounce = createDebounce();

const defaultConfig = {
  id: undefined as string | undefined,
  icon: {
    type: "emoji",
    value:
      "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f916.png",
    style: {
      backgroundColor: BACKGROUND_COLORS[0],
    },
  } as WorkflowIcon,
  name: "",
  description: "",
};

const zodSchema = z.object({
  id: z.string().optional(),
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z -]+$/),
  description: z.string().max(200).optional(),
  icon: z.object({
    type: z.enum(["emoji"]),
    value: z.string().min(1),
    style: z
      .object({
        backgroundColor: z.string().min(1),
      })
      .optional(),
  }),
});

export function EditWorkflowPopup({
  children,
  defaultValue,
  submitAfterRoute = true,
  onSave,
  open,
  onOpenChange,
}: {
  children?: React.ReactNode;
  defaultValue?: Pick<DBWorkflow, "id" | "name" | "description" | "icon">;
  submitAfterRoute?: boolean;
  open?: boolean;
  onSave?: (workflow: DBWorkflow) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations();
  const { theme } = useTheme();

  const getInitialConfig = () => {
    return defaultValue
      ? {
          description: defaultValue.description || "",
          icon: defaultValue.icon || defaultConfig.icon,
          name: defaultValue.name || "",
          id: defaultValue.id || "",
        }
      : { ...defaultConfig };
  };

  const [config, setConfig] = useObjectState<typeof defaultConfig>(
    getInitialConfig(),
  );

  const router = useRouter();

  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!requireCredits()) return;
    setLoading(true);
    toast.promise(
      safe(() => zodSchema.parse(config))
        .map(async (body) => {
          const response = await fetch("/api/workflow", {
            method: "POST",
            body: JSON.stringify(body),
          });
          const data = await response.json();
          return data as DBWorkflow;
        })
        .ifOk((workflow) => {
          onOpenChange?.(false);
          mutate("/api/workflow");
          if (submitAfterRoute) {
            router.push(`/workflow/${workflow.id}`);
          }
          onSave?.(workflow);
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setLoading(false))
        .unwrap(),
      {
        success: t("Common.success"),
        loading: t("Common.saving"),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        !open && setConfig(getInitialConfig());
        onOpenChange?.(open);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="p-2 md:p-10 pb-0">
        <DialogHeader className={cn("mb-4", config.id && "sr-only")}>
          <DialogTitle>{t("Workflow.createWorkflow")}</DialogTitle>
          <DialogDescription asChild>
            <div className="mt-2">
              <p>{t("Workflow.createWorkflowDescription")}</p>
              <p className="mt-1">{t("Workflow.workflowDescription")}</p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex w-full h-full gap-10">
          {/* Left: Form */}
          <div className="gap-6 flex flex-col justify-center w-full">
            <div className="flex gap-2">
              <div className="flex flex-col gap-2 flex-1">
                <Label htmlFor="workflow-name">
                  {t("Workflow.nameAndIcon")}
                </Label>
                <Input
                  value={config.name}
                  onChange={(e) => setConfig({ name: e.target.value })}
                  autoFocus
                  className="bg-input border-transparent"
                  id="workflow-name"
                  placeholder={t("Workflow.workflowNamePlaceholder")}
                />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div
                    style={{
                      backgroundColor: config.icon.style?.backgroundColor,
                    }}
                    className="transition-colors hover:bg-secondary! group items-center justify-center flex w-14 h-14 rounded-lg cursor-pointer ring ring-background hover:ring-ring"
                  >
                    <Avatar className="size-10">
                      <AvatarImage
                        src={config.icon.value}
                        className="group-hover:scale-110  transition-transform"
                      />
                      <AvatarFallback></AvatarFallback>
                    </Avatar>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="p-0 bg-transparent flex flex-col gap-2 border-none">
                  <div className="flex gap-2 border rounded-xl p-4  bg-secondary">
                    {BACKGROUND_COLORS.map((color, index) => (
                      <div
                        key={index}
                        className="w-6 h-6 rounded cursor-pointer"
                        onClick={() => {
                          setConfig({
                            icon: {
                              ...config.icon,
                              style: { backgroundColor: color },
                            },
                          });
                        }}
                        style={{ backgroundColor: color }}
                      ></div>
                    ))}
                    <div className="relative">
                      <input
                        type="color"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        onChange={(e) => {
                          colorUpdateDebounce(() => {
                            setConfig({
                              icon: {
                                ...config.icon!,
                                style: { backgroundColor: e.target.value },
                              },
                            });
                          }, 100);
                        }}
                      />
                      <div className="w-6 h-6 rounded cursor-pointer  border-muted-foreground/50 flex items-center justify-center hover:border-muted-foreground transition-colors">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{
                            backgroundColor:
                              config.icon?.style?.backgroundColor,
                          }}
                        ></div>
                      </div>
                    </div>
                  </div>
                  <EmojiPicker
                    lazyLoadEmojis
                    open
                    className="fade-300"
                    theme={theme == "dark" ? Theme.DARK : Theme.LIGHT}
                    onEmojiClick={(emoji) => {
                      setConfig({
                        icon: {
                          ...config.icon,
                          value: emoji.imageUrl,
                        },
                      });
                    }}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex flex-col gap-2">
              <Label
                className="flex items-center gap-1"
                htmlFor="workflow-description"
              >
                {t("Workflow.description")}
                <span className="text-xs text-muted-foreground">
                  {t("Common.optional")}
                </span>
              </Label>
              <Textarea
                id="workflow-description"
                placeholder={t("Workflow.descriptionPlaceholder")}
                className="resize-none min-h-[100px] bg-input border-transparent"
                value={config.description}
                onChange={(e) => setConfig({ description: e.target.value })}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("Common.cancel")}</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={loading}>
            {t("Common.save")}
            {loading && <Loader className="size-3.5 animate-spin" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

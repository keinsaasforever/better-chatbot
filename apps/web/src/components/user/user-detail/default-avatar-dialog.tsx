"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Button } from "ui/button";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { useTranslations } from "next-intl";

interface DefaultAvatarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (imageUrl: string) => void;
}

const DEFAULT_AVATARS = [
  { id: "pf", url: "/pf.webp", label: "Default" },
  { id: "p1", url: "/p1.png", label: "Avatar 1" },
  { id: "p2", url: "/p2.png", label: "Avatar 2" },
  { id: "p3", url: "/p3.png", label: "Avatar 3" },
  { id: "p4", url: "/p4.png", label: "Avatar 4" },
  { id: "p5", url: "/p5.png", label: "Avatar 5" },
];

export function DefaultAvatarDialog({
  open,
  onOpenChange,
  onSelect,
}: DefaultAvatarDialogProps) {
  const tCommon = useTranslations("Common");
  const t = useTranslations("User.Profile.common");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (id: string, url: string) => {
    setSelectedId(id);
    onSelect(url);
    // Close dialog after a short delay for visual feedback
    setTimeout(() => {
      onOpenChange(false);
      setSelectedId(null);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("selectDefaultAvatar")}</DialogTitle>
          <DialogDescription>
            {t("selectDefaultAvatarDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4 py-4">
          {DEFAULT_AVATARS.map((avatar) => (
            <button
              key={avatar.id}
              type="button"
              onClick={() => handleSelect(avatar.id, avatar.url)}
              className={cn(
                "relative group aspect-square rounded-full overflow-hidden border-2 transition-all hover:scale-105",
                selectedId === avatar.id
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border hover:border-primary/50",
              )}
            >
              <Avatar className="size-full rounded-full ring ring-border">
                <AvatarImage src={avatar.url || undefined} />
                <AvatarFallback className="text-lg font-semibold">
                  {avatar.label.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              {/* Overlay on hover */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                {selectedId === avatar.id ? (
                  <div className="bg-primary rounded-full p-2">
                    <Check className="size-5 text-primary-foreground" />
                  </div>
                ) : (
                  <span className="text-white text-sm font-medium">
                    {t("select")}
                  </span>
                )}
              </div>

              {/* Selected indicator */}
              {selectedId === avatar.id && (
                <div className="absolute top-2 right-2 bg-primary rounded-full p-1">
                  <Check className="size-4 text-primary-foreground" />
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

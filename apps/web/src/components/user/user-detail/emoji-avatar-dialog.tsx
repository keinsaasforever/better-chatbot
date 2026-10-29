"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Button } from "ui/button";
import EmojiPicker, { Theme, EmojiClickData } from "emoji-picker-react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";

interface EmojiAvatarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (emojiUrl: string) => void;
}

export function EmojiAvatarDialog({
  open,
  onOpenChange,
  onSelect,
}: EmojiAvatarDialogProps) {
  const { theme } = useTheme();
  const t = useTranslations("User.Profile.common");
  const tCommon = useTranslations("Common");

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    // Use the emoji image URL from emoji-picker-react
    onSelect(emojiData.imageUrl);

    // Close dialog after a short delay for visual feedback
    setTimeout(() => {
      onOpenChange(false);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("chooseEmojiAvatar")}</DialogTitle>
          <DialogDescription>
            {t("chooseEmojiAvatarDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 flex justify-center">
          <EmojiPicker
            lazyLoadEmojis
            open={open}
            theme={theme === "dark" ? Theme.DARK : Theme.LIGHT}
            onEmojiClick={handleEmojiClick}
            width="100%"
            height={400}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

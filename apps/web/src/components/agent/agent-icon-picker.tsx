"use client";

import { useTheme } from "next-themes";
import EmojiPicker, { Theme } from "emoji-picker-react";
import { BACKGROUND_COLORS } from "lib/const";
import { createDebounce, cn } from "lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { AgentIcon } from "app-types/agent";

const colorUpdateDebounce = createDebounce();

interface AgentIconPickerProps {
  icon?: AgentIcon;
  disabled?: boolean;
  onChange: (icon: AgentIcon) => void;
}

export function AgentIconPicker({
  icon,
  disabled = false,
  onChange,
}: AgentIconPickerProps) {
  const { theme } = useTheme();

  const handleColorChange = (color: string) => {
    onChange({
      ...icon!,
      style: { backgroundColor: color },
    });
  };

  const handleEmojiSelect = (emoji: any) => {
    onChange({
      ...icon!,
      value: emoji.imageUrl,
      type: "emoji",
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <div
          style={{
            backgroundColor: icon?.style?.backgroundColor,
          }}
          className={cn(
            "transition-colors group items-center justify-center flex w-16 h-16 rounded-lg ring ring-background",
            !disabled && "hover:bg-secondary! cursor-pointer hover:ring-ring",
          )}
        >
          <Avatar className="size-10">
            <AvatarImage
              src={icon?.value}
              className="group-hover:scale-110 transition-transform"
            />
            <AvatarFallback></AvatarFallback>
          </Avatar>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="p-0 bg-transparent flex flex-col gap-2 border-none">
        <div className="flex gap-2 border rounded-xl p-4 bg-secondary">
          {BACKGROUND_COLORS.map((color, index) => (
            <div
              key={index}
              className="w-6 h-6 rounded cursor-pointer"
              onClick={() => handleColorChange(color)}
              style={{ backgroundColor: color }}
            />
          ))}
          <div className="relative">
            <input
              type="color"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={(e) => {
                colorUpdateDebounce(() => {
                  handleColorChange(e.target.value);
                }, 100);
              }}
            />
            <div className="w-6 h-6 rounded cursor-pointer border-muted-foreground/50 flex items-center justify-center hover:border-muted-foreground transition-colors">
              <div
                className="w-3 h-3 rounded-full"
                style={{
                  backgroundColor: icon?.style?.backgroundColor,
                }}
              />
            </div>
          </div>
        </div>
        <EmojiPicker
          lazyLoadEmojis
          open
          className="fade-300"
          theme={theme === "dark" ? Theme.DARK : Theme.LIGHT}
          onEmojiClick={handleEmojiSelect}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

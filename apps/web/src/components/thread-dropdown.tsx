"use client";
import { deleteThreadAction, updateThreadAction } from "@/app/api/chat/actions";
import { useToRef } from "@/hooks/use-latest";
import { Loader, PencilLine, Trash, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type PropsWithChildren, useState } from "react";
import { toast } from "sonner";
import { mutate } from "swr";
import { safe } from "ts-safe";
import { Button } from "ui/button";
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
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "ui/command";
import { useTranslations } from "next-intl";
import { appStore } from "@/app/store";
import { ChatExportPopup } from "./export/chat-export-popup";

type Props = PropsWithChildren<{
  threadId: string;
  beforeTitle?: string;
  onDeleted?: () => void;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "end" | "center";
}>;

export function ThreadDropdown({
  threadId,
  children,
  beforeTitle,
  onDeleted,
  side,
  align,
}: Props) {
  const router = useRouter();
  const t = useTranslations();
  const push = useToRef(router.push);

  const currentThreadId = appStore((state) => state.currentThreadId);

  const [open, setOpen] = useState(false);

  const [isDeleting, setIsDeleting] = useState(false);

  const handleUpdate = async (title: string) => {
    safe()
      .ifOk(() => {
        if (!title) {
          throw new Error(t("Chat.Thread.titleRequired"));
        }
      })
      .ifOk(() => updateThreadAction(threadId, { title }))
      .ifOk(() => mutate("/api/thread"))
      .watch(({ isOk, error }) => {
        if (!isOk) {
          toast.error(error.message || t("Chat.Thread.failedToUpdateThread"));
        }
      });
  };

  const handleDelete = async (_e: React.MouseEvent) => {
    safe()
      .watch(() => setIsDeleting(true))
      .ifOk(() => deleteThreadAction(threadId))
      .watch(() => setIsDeleting(false))
      .watch(() => setOpen(false))
      .watch(({ isOk, error }) => {
        if (!isOk) {
          toast.error(error.message || t("Chat.Thread.failedToDeleteThread"));
        }
      })
      .ifOk(() => onDeleted?.())
      .ifOk(() => {
        if (currentThreadId === threadId) {
          push.current("/");
        }
        mutate("/api/thread");
      })
      .unwrap();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="p-0 w-[220px]" side={side} align={align}>
        <Command>
          <div className="flex items-center gap-2 px-2 py-1 text-xs pt-2 text-muted-foreground ml-1">
            {t("Chat.Thread.chat")}
          </div>

          <CommandList>
            <CommandGroup>
              <CommandItem className="cursor-pointer p-0">
                <ChatExportPopup threadId={threadId}>
                  <div className="flex items-center gap-2 w-full px-2 py-1 rounded">
                    <UploadIcon className="text-foreground" />
                    <span className="mr-4">{t("Chat.Thread.exportChat")}</span>
                  </div>
                </ChatExportPopup>
              </CommandItem>
              <CommandItem className="cursor-pointer p-0">
                <UpdateThreadNameDialog
                  initialTitle={beforeTitle ?? ""}
                  onUpdated={(title) => handleUpdate(title)}
                >
                  <div className="flex items-center gap-2 w-full px-2 py-1 rounded">
                    <PencilLine className="text-foreground" />
                    <span className="mr-4">{t("Chat.Thread.renameChat")}</span>
                  </div>
                </UpdateThreadNameDialog>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem disabled={isDeleting} className="cursor-pointer p-0">
                <div
                  className="flex items-center gap-2 w-full px-2 py-1 rounded"
                  onClick={handleDelete}
                >
                  <Trash className="text-destructive" />
                  <span className="text-destructive">
                    {t("Chat.Thread.deleteChat")}
                  </span>
                  {isDeleting && (
                    <Loader className="ml-auto h-4 w-4 animate-spin" />
                  )}
                </div>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function UpdateThreadNameDialog({
  initialTitle,
  children,
  onUpdated,
}: PropsWithChildren<{
  initialTitle: string;
  onUpdated: (title: string) => void;
}>) {
  const [title, setTitle] = useState(initialTitle);
  const t = useTranslations();
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("Chat.Thread.renameChat")}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          <Input
            type="text"
            value={title}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onUpdated(title);
              }
            }}
            onInput={(e) => {
              setTitle(e.currentTarget.value);
            }}
          />
        </DialogDescription>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{t("Common.cancel")}</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="outline" onClick={() => onUpdated(title)}>
              {t("Common.update")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

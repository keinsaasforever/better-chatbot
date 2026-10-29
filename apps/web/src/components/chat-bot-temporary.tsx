"use client";
import { appStore } from "@/app/store";
import { useChatCore } from "@/hooks/use-chat-core";
import { useGlobalShortcut } from "@/hooks/use-global-shortcut";
import { useScrollAnchor } from "@/hooks/use-scroll-anchor";
import type { UseChatHelpers } from "@ai-sdk/react";
import { cn } from "lib/utils";

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "ui/drawer";

import { DialogTitle } from "@radix-ui/react-dialog";
import { DefaultChatTransport, UIMessage } from "ai";
import { Shortcuts, isShortcutEvent } from "lib/keyboard-shortcuts";
import { Settings2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from "ui/dialog";
import { Separator } from "ui/separator";
import { Textarea } from "ui/textarea";
import { Think } from "ui/think";
import { useShallow } from "zustand/shallow";
import { ChatMessageList } from "./chat-message-list";
import { ErrorMessage } from "./message";
import PromptInput from "./prompt-input";

export function ChatBotTemporary() {
  const t = useTranslations("Chat.TemporaryChat");

  const [temporaryChat, appStoreMutate] = appStore(
    useShallow((state) => [state.temporaryChat, state.mutate]),
  );
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false);

  const setOpen = (bool: boolean) => {
    appStoreMutate({
      temporaryChat: {
        ...temporaryChat,
        isOpen: bool,
      },
    });
  };

  const [input, setInput] = useState("");

  const {
    messages,
    sendMessage,
    clearError,
    status,
    setMessages,
    error,
    stop,
  } = useChatCore({
    transport: new DefaultChatTransport({
      api: "/api/chat/temporary",
      prepareSendMessagesRequest: ({ messages }) => {
        const temporaryChat = appStore.getState().temporaryChat;
        return {
          body: {
            chatModel: temporaryChat.chatModel,
            instructions: temporaryChat.instructions,
            messages,
          },
        };
      },
    }),
  });

  const isLoading = useMemo(
    () => status === "streaming" || status === "submitted",
    [status],
  );

  const reset = useCallback(() => {
    setMessages([]);
    clearError();
  }, []);

  useGlobalShortcut(
    (e: KeyboardEvent) => {
      if (isShortcutEvent(e, Shortcuts.toggleTemporaryChat)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        appStoreMutate((prev) => ({
          temporaryChat: {
            ...prev.temporaryChat,
            isOpen: !prev.temporaryChat.isOpen,
          },
        }));
      } else if (
        temporaryChat.isOpen &&
        isShortcutEvent(e, {
          shortcut: {
            command: true,
            key: "e",
          },
        })
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        reset();
      } else if (
        temporaryChat.isOpen &&
        isShortcutEvent(e, {
          shortcut: {
            command: true,
            key: "i",
          },
        })
      ) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setIsInstructionsOpen((prev) => !prev);
      }
    },
    [temporaryChat.isOpen],
  );

  return (
    <Drawer
      handleOnly
      direction="right"
      open={temporaryChat.isOpen}
      onOpenChange={setOpen}
    >
      <DrawerContent
        style={{
          userSelect: "text",
        }}
        className="w-full md:w-2xl px-2 flex flex-col"
      >
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <p className="hidden sm:flex">{t("temporaryChat")}</p>

            <div className="flex-1" />

            <Button
              variant={"secondary"}
              className="rounded-full"
              onClick={reset}
              disabled={isLoading}
            >
              {t("resetChat")}
              <Separator orientation="vertical" />
              <span className="text-xs text-muted-foreground ml-1">⌘E</span>
            </Button>
            <TemporaryChatInstructions
              isOpen={isInstructionsOpen}
              setIsOpen={setIsInstructionsOpen}
              instructions={temporaryChat.instructions ?? ""}
              onSave={(instructions) => {
                appStoreMutate({
                  temporaryChat: { ...temporaryChat, instructions },
                });
              }}
            >
              <Button variant={"secondary"} className="rounded-full">
                <Settings2 />
                <Separator orientation="vertical" />
                <span className="text-xs text-muted-foreground ml-1">⌘I</span>
              </Button>
            </TemporaryChatInstructions>
            <DrawerClose asChild>
              <Button
                variant={"secondary"}
                className="flex items-center gap-1 rounded-full"
              >
                <X />
                <Separator orientation="vertical" />
                <span className="text-xs text-muted-foreground ml-1">ESC</span>
              </Button>
            </DrawerClose>
          </DrawerTitle>
          <DrawerDescription className="sr-only"></DrawerDescription>
        </DrawerHeader>
        <DrawerTemporaryContent
          isLoading={isLoading}
          messages={messages}
          error={error}
          input={input}
          setInput={setInput}
          sendMessage={sendMessage}
          setMessages={setMessages}
          stop={stop}
          status={status}
        />
      </DrawerContent>
    </Drawer>
  );
}

function DrawerTemporaryContent({
  messages,
  input,
  setInput,
  sendMessage,
  status,
  error,
  isLoading,
  setMessages,
  stop,
}: {
  messages: UIMessage[];
  input: string;
  setInput: (input: string) => void;
  sendMessage: UseChatHelpers<UIMessage>["sendMessage"];
  status: "submitted" | "streaming" | "ready" | "error";
  isLoading: boolean;
  error: Error | undefined;
  setMessages: UseChatHelpers<UIMessage>["setMessages"];
  stop: UseChatHelpers<UIMessage>["stop"];
}) {
  const t = useTranslations("Chat");
  const { containerRef, isAtBottom, handleScroll, scrollToBottom } =
    useScrollAnchor({ threshold: 20 });

  const [temporaryChat, appStoreMutate] = appStore(
    useShallow((state) => [state.temporaryChat, state.mutate]),
  );

  // Mount at the bottom, then stay pinned there while streaming unless the
  // user scrolls up (isAtBottom flips false via the container's onScroll).
  useEffect(() => {
    scrollToBottom("instant");
  }, []);

  useEffect(() => {
    if (isAtBottom) scrollToBottom("instant");
  }, [messages]);

  const setModel = useCallback((model) => {
    appStoreMutate({
      temporaryChat: {
        ...temporaryChat,
        chatModel: model,
      },
    });
  }, []);

  useEffect(() => {
    if (!temporaryChat.chatModel) {
      appStoreMutate((state) => {
        if (!state.chatModel) return state;
        return {
          temporaryChat: {
            ...temporaryChat,
            chatModel: state.chatModel,
          },
        };
      });
    }
  }, [Boolean(temporaryChat.chatModel)]);

  return (
    <div
      className={cn("flex flex-col min-w-0 h-full flex-1 overflow-y-hidden")}
    >
      {!messages.length && !error && (
        <div className="flex-1 items-center flex">
          <div className="max-w-3xl mx-auto my-4">
            {" "}
            <div className="rounded-xl p-6 flex flex-col gap-2 leading-relaxed text-center">
              <h1 className="text-4xl font-semibold ">
                {t("TemporaryChat.thisChatWontBeSaved")}
              </h1>
            </div>
          </div>
        </div>
      )}
      <div
        className={
          "flex flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-x-none min-w-0 py-6"
        }
        ref={containerRef}
        onScroll={handleScroll}
      >
        <ChatMessageList
          messages={messages}
          status={status}
          isLoading={isLoading}
          setMessages={setMessages}
          sendMessage={sendMessage}
        />
        {isLoading && (
          <div className="w-full mx-auto max-w-3xl px-6">
            <Think />
          </div>
        )}
        {error && <ErrorMessage error={error} />}
      </div>

      <div className={"w-full my-6 mt-auto"}>
        <PromptInput
          input={input}
          sendMessage={sendMessage}
          disabledMention={true}
          model={temporaryChat.chatModel}
          setModel={setModel}
          toolDisabled
          placeholder={t("TemporaryChat.feelFreeToAskAnythingTemporarily")}
          setInput={setInput}
          voiceDisabled
          isLoading={isLoading}
          onStop={stop}
        />
      </div>
    </div>
  );
}

function TemporaryChatInstructions({
  instructions,
  onSave,
  children,
  isOpen,
  setIsOpen,
}: {
  instructions: string;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onSave: (instructions: string) => void;
  children: ReactNode;
}) {
  const [input, setInput] = useState(instructions);
  const t = useTranslations();
  useEffect(() => {
    if (isOpen) {
      setInput(instructions);
    }
  }, [isOpen]);
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("Chat.TemporaryChat.temporaryChatInstructions")}
          </DialogTitle>
          <DialogDescription>
            {t("Chat.TemporaryChat.temporaryChatInstructionsDescription")}
          </DialogDescription>
        </DialogHeader>
        <DialogDescription>
          <Textarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="resize-none h-40"
            placeholder={t(
              "Chat.TemporaryChat.temporaryChatInstructionsPlaceholder",
            )}
          />
        </DialogDescription>
        <DialogFooter>
          <Button
            onClick={() => {
              onSave(input);
              setIsOpen(false);
            }}
          >
            {t("Common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

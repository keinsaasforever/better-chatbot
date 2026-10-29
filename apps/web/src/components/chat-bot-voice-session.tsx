"use client";

import { appStore } from "@/app/store";
import { useScrollAnchor } from "@/hooks/use-scroll-anchor";
import { useVoiceToolMentions } from "@/hooks/use-voice-tool-mentions";
import { TextPart, getToolName, isToolUIPart } from "ai";
import { DEFAULT_VOICE_TOOLS, UIMessageWithCompleted } from "lib/ai/speech";
import { useOpenAIVoiceChat as OpenAIVoiceChat } from "lib/ai/speech/open-ai/use-voice-chat.openai";
import { getVoiceAppToolDefinitions } from "lib/voice/app-tool-definitions";
import { useMirrorVoiceLiveStatus } from "lib/voice/voice-live-status";
import { cn, groupBy } from "lib/utils";
import {
  ChevronRight,
  Loader,
  MessageSquareMoreIcon,
  MessagesSquareIcon,
  MessageSquareTextIcon,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  SquareIcon,
  TriangleAlertIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { safe } from "ts-safe";
import { Alert, AlertDescription, AlertTitle } from "ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Button } from "ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "ui/dialog";
import { Drawer, DrawerContent, DrawerPortal, DrawerTitle } from "ui/drawer";
import JsonView from "ui/json-view";
import { MessageLoading } from "ui/message-loading";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { useShallow } from "zustand/shallow";
import { EnabledTools, EnabledToolsDropdown } from "./enabled-tools-dropdown";
import { ToolMessagePart } from "./message-parts";
import { VoiceBrowserPreview } from "./voice/voice-browser-preview";
import { VoiceSettingsPopover } from "./voice/voice-settings-popover";
import { VoiceDeviceSettingsDialog } from "./voice-device-settings-dialog";

/**
 * The always-present tool groups, for the read-only tools dropdown.
 *
 * Takes the same capability filter the session route applies, so the list
 * cannot advertise a browser tool an org has switched off.
 */
const buildPrependTools = (browserAutomation: boolean): EnabledTools[] => [
  {
    groupName: "App",
    tools: getVoiceAppToolDefinitions({ browserAutomation }).map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  },
  {
    // Not "Browser": these control the app's own UI (theme, hanging up), and
    // that label now reads as browser automation, which lives under "App".
    groupName: "Session",
    tools: DEFAULT_VOICE_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  },
];

export function VoiceChatSession() {
  const t = useTranslations("Chat");
  const [agentId, appStoreMutate, voiceChat] = appStore(
    useShallow((state) => [
      state.voiceChat.agentId,
      state.mutate,
      state.voiceChat,
    ]),
  );

  const { agent, toolMentions } = useVoiceToolMentions(agentId);
  const router = useRouter();
  // Functional update: two quick changes in the settings panel must not
  // overwrite each other through a stale `voiceChat` closure.
  const updateVoiceOptions = useCallback(
    (patch: { voice?: string; settings?: unknown }) => {
      appStoreMutate((state) => ({
        voiceChat: {
          ...state.voiceChat,
          options: {
            provider: "openai",
            providerOptions: {
              ...state.voiceChat.options.providerOptions,
              ...patch,
            },
          },
        },
      }));
    },
    [appStoreMutate],
  );

  const [isClosing, setIsClosing] = useState(false);
  const startAudio = useRef<HTMLAudioElement>(null);
  const [useCompactView, setUseCompactView] = useState(true);
  const [deviceSettingsOpen, setDeviceSettingsOpen] = useState(false);

  const {
    isListening,
    isAssistantSpeaking,
    isLoading,
    isActive,
    isUserSpeaking,
    messages,
    threadId,
    error,
    toolStatus,
    toolWarning,
    browserAutomationEnabled,
    browserPreview,
    dismissBrowserPreview,
    start,
    startListening,
    stop,
    stopListening,
    interruptResponse,
    sessionConfirmation,
    settingsPending,
    sessionVoice,
  } = OpenAIVoiceChat({
    toolMentions,
    agentId,
    ...voiceChat.options.providerOptions,
    context: voiceChat.context,
  });

  // Mirror the session state for controls outside the drawer (the cockpit's
  // COM 1 pushbutton); the drawer unmounts on close, which resets it.
  useMirrorVoiceLiveStatus({ isLoading, isActive, isUserSpeaking });

  const startWithSound = useCallback(() => {
    if (!startAudio.current) {
      startAudio.current = new Audio("/sounds/start_voice.ogg");
    }
    start().then(() => {
      startAudio.current?.play().catch(() => {});
    });
  }, [start]);

  const endVoiceChat = useCallback(async () => {
    setIsClosing(true);
    await safe(() => stop());
    setIsClosing(false);
    appStoreMutate({
      voiceChat: {
        ...voiceChat,
        isOpen: false,
        // The opener sets it again; a stale "cockpit" must not follow the
        // user into the next voice chat opened from somewhere else.
        context: undefined,
      },
    });
  }, [appStoreMutate, stop, voiceChat]);

  /**
   * Leave the call and land in the thread it was saved to.
   *
   * The transcript in the drawer is gone the moment the drawer closes, and a
   * spoken summary of a web search is not the search — the links only exist in
   * the persisted thread. Hanging up first flushes the last turn.
   */
  const openInChat = useCallback(async () => {
    if (!threadId) return;
    await endVoiceChat();
    router.push(`/chat/${threadId}`);
  }, [endVoiceChat, router, threadId]);

  const statusMessage = useMemo(() => {
    if (isLoading) {
      return (
        <p className="fade-in animate-in duration-3000" key="start">
          {t("VoiceChat.preparing")}
        </p>
      );
    }
    if (!isActive)
      return (
        <p className="fade-in animate-in duration-3000" key="start">
          {t("VoiceChat.startVoiceChat")}
        </p>
      );
    if (!isListening)
      return (
        <p className="fade-in animate-in duration-3000" key="stop">
          {t("VoiceChat.yourMicIsOff")}
        </p>
      );
    if (!isAssistantSpeaking && messages.length === 0) {
      return (
        <p className="fade-in animate-in duration-3000" key="ready">
          {t("VoiceChat.readyWhenYouAreJustStartTalking")}
        </p>
      );
    }
    if (isUserSpeaking && useCompactView) {
      return <MessageLoading className="text-muted-foreground" />;
    }
    if (!isAssistantSpeaking && !isUserSpeaking) {
      return (
        <p className="delayed-fade-in" key="ready">
          {t("VoiceChat.readyWhenYouAreJustStartTalking")}
        </p>
      );
    }
  }, [
    isAssistantSpeaking,
    isUserSpeaking,
    isActive,
    isLoading,
    isListening,
    messages.length,
    useCompactView,
    t,
  ]);

  const mcpTools = useMemo<EnabledTools[]>(() => {
    const groupByServer = groupBy(toolStatus.available, "serverName");
    return Object.entries(groupByServer).map(([serverName, tools]) => {
      return {
        groupName: serverName,
        tools: tools.map((v) => ({
          name: v.toolName,
          description: v.description,
        })),
      };
    });
  }, [toolStatus.available]);

  const tools = useMemo<EnabledTools[]>(() => {
    return [...buildPrependTools(browserAutomationEnabled), ...mcpTools];
  }, [browserAutomationEnabled, mcpTools]);

  useEffect(() => {
    if (!error) {
      return;
    }

    toast.error(error.message);
    if (isActive) {
      stop();
    }
  }, [error, isActive, stop]);

  return (
    <>
      <Drawer dismissible={false} open={voiceChat.isOpen} direction="top">
        <DrawerPortal>
          <DrawerContent className="max-h-[100vh]! h-full border-none! rounded-none! flex flex-col bg-card">
            <div className="w-full h-full flex flex-col ">
              <div
                className="w-full flex p-6 gap-2"
                style={{
                  userSelect: "text",
                }}
              >
                {agent && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        style={agent.icon?.style}
                        className="size-9 items-center justify-center flex rounded-lg ring ring-secondary"
                      >
                        <Avatar className="size-6">
                          <AvatarImage src={agent.icon?.value} />
                          <AvatarFallback>
                            {agent.name.slice(0, 1)}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="p-3 max-w-xs">
                      <div className="space-y-2">
                        <div className="font-semibold text-sm">
                          {agent.name}
                        </div>
                        {agent.description && (
                          <div className="text-xs text-muted-foreground leading-relaxed">
                            {agent.description}
                          </div>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={"secondary"}
                      size={"icon"}
                      onClick={() => setUseCompactView(!useCompactView)}
                    >
                      {useCompactView ? (
                        <MessageSquareMoreIcon />
                      ) : (
                        <MessagesSquareIcon />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {useCompactView
                      ? t("VoiceChat.compactDisplayMode")
                      : t("VoiceChat.conversationDisplayMode")}
                  </TooltipContent>
                </Tooltip>

                {/*
                  Only once a turn has actually been written: a link to a thread
                  that does not exist yet would 404 on the first click of a
                  session.
                */}
                {threadId && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={"secondary"}
                        size={"icon"}
                        disabled={isClosing}
                        onClick={openInChat}
                      >
                        <MessageSquareTextIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("VoiceChat.openInChat")}</TooltipContent>
                  </Tooltip>
                )}

                <EnabledToolsDropdown
                  align="start"
                  side="bottom"
                  tools={tools}
                />

                <DrawerTitle className="ml-auto">
                  <VoiceSettingsPopover
                    voice={voiceChat.options.providerOptions?.voice}
                    settings={voiceChat.options.providerOptions?.settings}
                    onChange={updateVoiceOptions}
                    disabled={isLoading || isClosing}
                    isActive={isActive}
                    sessionVoice={sessionVoice}
                    settingsPending={settingsPending === true}
                    confirmation={sessionConfirmation}
                    onOpenDevices={() => setDeviceSettingsOpen(true)}
                  />
                </DrawerTitle>
              </div>
              <div className="flex-1 min-h-0 w-full flex gap-4 px-4 md:px-6">
                <div
                  className={cn(
                    "min-h-0 w-full mx-auto flex flex-col",
                    // While a browser is on screen the transcript becomes the
                    // sidebar, and on a narrow viewport it gives way entirely:
                    // watching the run is the point, and two columns at 400px
                    // wide is neither.
                    browserPreview &&
                      "hidden md:flex md:w-[360px] md:shrink-0 md:mx-0",
                  )}
                >
                  {error ? (
                    <div className="max-w-3xl mx-auto">
                      <Alert variant={"destructive"}>
                        <TriangleAlertIcon className="size-4 " />
                        <AlertTitle className="">Error</AlertTitle>
                        <AlertDescription>{error.message}</AlertDescription>

                        <AlertDescription className="my-4 ">
                          <p className="text-muted-foreground ">
                            {t("VoiceChat.pleaseCloseTheVoiceChatAndTryAgain")}
                          </p>
                        </AlertDescription>
                      </Alert>
                    </div>
                  ) : null}
                  {toolWarning ? (
                    <div className="max-w-3xl mx-auto">
                      <Alert>
                        <TriangleAlertIcon className="size-4" />
                        <AlertTitle>Some MCP tools are unavailable</AlertTitle>
                        <AlertDescription>{toolWarning}</AlertDescription>
                      </Alert>
                    </div>
                  ) : null}
                  {isLoading ? (
                    <div className="flex-1"></div>
                  ) : (
                    <div className="h-full w-full min-h-0">
                      {useCompactView ? (
                        <CompactMessageView messages={messages} />
                      ) : (
                        <ConversationView messages={messages} />
                      )}
                    </div>
                  )}
                </div>
                {browserPreview && (
                  <div className="flex-1 min-h-0 py-2">
                    <VoiceBrowserPreview
                      frame={browserPreview}
                      onDismiss={dismissBrowserPreview}
                    />
                  </div>
                )}
              </div>
              <div className="relative w-full p-6 flex items-center justify-center gap-4">
                <div className="text-sm text-muted-foreground absolute -top-5 left-0 w-full justify-center flex items-center">
                  {statusMessage}
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={"secondary"}
                      size={"icon"}
                      disabled={isClosing || isLoading || Boolean(error)}
                      onClick={() => {
                        if (!isActive) {
                          startWithSound();
                        } else if (isListening) {
                          stopListening();
                        } else {
                          startListening();
                        }
                      }}
                      className={cn(
                        "rounded-full p-6 transition-colors duration-300",

                        isLoading
                          ? "bg-accent-foreground text-accent animate-pulse"
                          : !isActive
                            ? "bg-green-500/10 text-green-500 hover:bg-green-500/30"
                            : !isListening
                              ? "bg-destructive/30 text-destructive hover:bg-destructive/10"
                              : isUserSpeaking
                                ? "bg-input text-foreground"
                                : "",
                      )}
                    >
                      {isLoading || isClosing ? (
                        <Loader className="size-6 animate-spin" />
                      ) : !isActive ? (
                        <PhoneIcon className="size-6 fill-green-500 stroke-none" />
                      ) : isListening ? (
                        <MicIcon
                          className={`size-6 ${isUserSpeaking ? "text-primary" : "text-muted-foreground transition-colors duration-300"}`}
                        />
                      ) : (
                        <MicOffIcon className="size-6" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {!isActive
                      ? t("VoiceChat.startConversation")
                      : isListening
                        ? t("VoiceChat.closeMic")
                        : t("VoiceChat.openMic")}
                  </TooltipContent>
                </Tooltip>
                {isActive && isAssistantSpeaking && interruptResponse && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={"secondary"}
                        size={"icon"}
                        className="rounded-full p-6"
                        disabled={isClosing}
                        onClick={interruptResponse}
                        aria-label={t("VoiceChat.stopAnswer")}
                      >
                        <SquareIcon className="text-foreground size-5 fill-current" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t("VoiceChat.stopAnswer")}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={"secondary"}
                      size={"icon"}
                      className="rounded-full p-6"
                      disabled={isLoading || isClosing}
                      onClick={endVoiceChat}
                    >
                      <XIcon className="text-foreground size-6" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t("VoiceChat.endConversation")}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </DrawerContent>
        </DrawerPortal>
      </Drawer>
      <VoiceDeviceSettingsDialog
        open={deviceSettingsOpen}
        onOpenChange={setDeviceSettingsOpen}
      />
    </>
  );
}

function ConversationView({
  messages,
}: { messages: UIMessageWithCompleted[] }) {
  const { containerRef, scrollToBottom } = useScrollAnchor();

  useEffect(() => {
    scrollToBottom("smooth");
  }, [messages.length]);
  return (
    <div
      className="select-text w-full overflow-y-auto h-full"
      ref={containerRef}
    >
      <div className="max-w-4xl mx-auto flex flex-col px-6 gap-6 pb-44 min-h-0 min-w-0">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex px-4 py-3",
              message.role == "user" &&
                "ml-auto max-w-2xl text-foreground rounded-2xl w-fit bg-input/40",
            )}
          >
            {!message.completed ? (
              <MessageLoading
                className={cn(
                  message.role == "user"
                    ? "text-muted-foreground"
                    : "text-foreground",
                )}
              />
            ) : (
              message.parts.map((part, index) => {
                if (part.type === "text") {
                  if (!part.text) {
                    return (
                      <MessageLoading
                        key={index}
                        className={cn(
                          message.role == "user"
                            ? "text-muted-foreground"
                            : "text-foreground",
                        )}
                      />
                    );
                  }
                  return (
                    <p key={index}>
                      {(part.text || "...")
                        ?.trim()
                        .split(" ")
                        .map((word, wordIndex) => (
                          <span
                            key={wordIndex}
                            className="animate-in fade-in duration-3000"
                          >
                            {word}{" "}
                          </span>
                        ))}
                    </p>
                  );
                } else if (isToolUIPart(part)) {
                  return (
                    <ToolMessagePart
                      key={index}
                      part={part as any}
                      showActions={false}
                      messageId={message.id}
                      isLast={part.state.startsWith("input")}
                    />
                  );
                }
                return <p key={index}>{part.type} unknown part</p>;
              })
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CompactMessageView({
  messages,
}: {
  messages: UIMessageWithCompleted[];
}) {
  const { toolParts, textPart } = useMemo(() => {
    const toolParts = messages
      .filter((msg) => msg.parts.some(isToolUIPart))
      .map((msg) => msg.parts.find(isToolUIPart));

    const textPart = messages.findLast((msg) => msg.role === "assistant")
      ?.parts[0] as TextPart;
    return { toolParts, textPart };
  }, [messages]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div className="absolute bottom-6 max-h-[80vh] overflow-y-auto left-6 z-10 flex-col gap-2 hidden md:flex">
        {toolParts.map((toolPart, index) => {
          const isExecuting = toolPart?.state.startsWith("input");
          if (!toolPart) return null;
          return (
            <Dialog key={index}>
              <DialogTrigger asChild>
                <div className="animate-in slide-in-from-bottom-2 fade-in duration-3000 max-w-xs w-full">
                  <Button
                    variant={"outline"}
                    size={"icon"}
                    className="w-full bg-card flex items-center gap-2 px-2 text-xs text-muted-foreground"
                  >
                    <WrenchIcon className="size-3.5" />
                    <span className="text-sm font-bold min-w-0 truncate mr-auto">
                      {getToolName(toolPart)}
                    </span>
                    {isExecuting ? (
                      <Loader className="size-3.5 animate-spin" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                  </Button>
                </div>
              </DialogTrigger>
              <DialogContent className="z-50 md:max-w-2xl! max-h-[80vh] overflow-y-auto p-8">
                <DialogTitle>{getToolName(toolPart)}</DialogTitle>
                <div className="flex flex-row gap-4 text-sm ">
                  <div className="w-1/2 min-w-0 flex flex-col">
                    <div className="flex items-center gap-2 mb-2 pt-2 pb-1 z-10">
                      <h5 className="text-muted-foreground text-sm font-medium">
                        Inputs
                      </h5>
                    </div>
                    <JsonView data={toolPart.input} />
                  </div>

                  <div className="w-1/2 min-w-0 pl-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-4 pt-2 pb-1  z-10">
                      <h5 className="text-muted-foreground text-sm font-medium">
                        Outputs
                      </h5>
                    </div>
                    <JsonView
                      data={
                        toolPart.state === "output-available"
                          ? toolPart.output
                          : toolPart.state == "output-error"
                            ? toolPart.errorText
                            : {}
                      }
                    />
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          );
        })}
      </div>

      {textPart && (
        <div className="w-full mx-auto h-full max-h-[80vh] overflow-y-auto px-4 lg:max-w-4xl flex-1 flex items-center">
          <div className="animate-in fade-in-50 duration-1000">
            <p className="text-2xl md:text-3xl lg:text-4xl font-semibold leading-tight tracking-wide">
              {textPart.text?.split(" ").map((word, wordIndex) => (
                <span
                  key={wordIndex}
                  className="animate-in fade-in duration-5000"
                >
                  {word}{" "}
                </span>
              ))}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

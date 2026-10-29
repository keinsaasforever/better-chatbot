"use client";

import { UploadedFile, appStore } from "@/app/store";
import { UIMessage, UseChatHelpers } from "@ai-sdk/react";
import { ChatMention, ChatModel } from "app-types/chat";
import {
  ChevronDown,
  CornerRightUp,
  FileIcon,
  FileTextIcon,
  ImagesIcon,
  LibraryBig,
  Loader2,
  MicIcon,
  Paintbrush,
  PaperclipIcon,
  PlusIcon,
  Sparkles,
  Square,
  XIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "ui/button";
import { useShallow } from "zustand/shallow";
import { SelectModel } from "./select-model";
import { ToolModeDropdown } from "./tool-mode-dropdown";

import { setThreadKnowledgeBasesAction } from "@/app/api/chat/actions";
import { useFileUpload } from "@/hooks/use-presigned-upload";
import { useThreadFileUploader } from "@/hooks/use-thread-file-uploader";
import { requireCredits } from "@/lib/billing/require-credits";
import { MAX_KNOWLEDGE_SOURCES } from "@/lib/chat/knowledge-base-mentions";
import { cn } from "@/lib/utils";
import { Editor } from "@tiptap/react";
import { WorkflowSummary } from "app-types/workflow";
import {
  AUTO_IMAGE_MODEL_ID,
  isAutoImageModel,
  resolveImageModel,
} from "lib/ai/image/image-models";
import { DefaultToolName } from "lib/ai/tools";
import equal from "lib/equal";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { ClaudeIcon } from "ui/claude-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { GeminiIcon } from "ui/gemini-icon";
import { GrokIcon } from "ui/grok-icon";
import { MCPIcon } from "ui/mcp-icon";
import { OpenAIIcon } from "ui/openai-icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { ProjectContextBadge } from "./chat/project-context-badge";
import { DefaultToolIcon } from "./default-tool-icon";
import { ImageMaskEditor } from "./image-mask-editor";
import {
  CREATE_NEW as KNOWLEDGE_BASE_CREATE_NEW,
  KnowledgeBaseDialog,
  type KnowledgeBaseTarget,
} from "./knowledge-base/knowledge-base-dialog";
import { KnowledgeBaseMenu } from "./knowledge-base/knowledge-base-menu";
import { ToolSelectDropdown } from "./tool-select-dropdown";

import { useChatModels } from "@/hooks/queries/use-chat-models";
import { useAssemblyAI } from "@/hooks/use-assembly-ai";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  isFilePartSupported,
  isSummarizeSupported,
} from "@/lib/ai/file-support";
import { FileUIPart, TextUIPart } from "ai";
import { AgentSummary } from "app-types/agent";
import { EMOJI_DATA } from "lib/const";
import { toast } from "sonner";
import type { ContextTokenUsage } from "./ai-elements/context";
import { ChatContextMeter } from "./chat-context-meter";

interface PromptInputProps {
  placeholder?: string;
  setInput: (value: string) => void;
  input: string;
  onStop: () => void;
  sendMessage: UseChatHelpers<UIMessage>["sendMessage"];
  toolDisabled?: boolean;
  isLoading?: boolean;
  model?: ChatModel;
  setModel?: (model: ChatModel) => void;
  voiceDisabled?: boolean;
  threadId?: string;
  disabledMention?: boolean;
  onFocus?: () => void;
  autoFocusInput?: boolean;
  embedded?: boolean;
  projectInfo?: {
    id: string;
    name: string;
  };
  showProjectContextBadge?: boolean;
  contextUsage?: ContextTokenUsage;
  contextUsageModel?: ChatModel;
}

const ChatMentionInput = dynamic(() => import("./chat-mention-input"), {
  ssr: false,
  loading() {
    return <div className="h-[2rem] w-full animate-pulse"></div>;
  },
});

export default function PromptInput({
  placeholder,
  sendMessage,
  model,
  setModel,
  input,
  onFocus,
  autoFocusInput = true,
  embedded = false,
  setInput,
  onStop,
  isLoading,
  toolDisabled,
  voiceDisabled,
  threadId,
  disabledMention,
  projectInfo,
  showProjectContextBadge = true,
  contextUsage,
  contextUsageModel,
}: PromptInputProps) {
  const t = useTranslations("Chat");
  const isMobile = useIsMobile();
  const toolbarCompact = isMobile;
  const [isUploadDropdownOpen, setIsUploadDropdownOpen] = useState(false);
  // The upload a brush mask is being drawn for; null closes the editor.
  const [maskTarget, setMaskTarget] = useState<UploadedFile | null>(null);
  const [isApplyingMask, setIsApplyingMask] = useState(false);
  const { upload: uploadMaskFile } = useFileUpload();
  const [isKnowledgeBaseDialogOpen, setIsKnowledgeBaseDialogOpen] =
    useState(false);
  const [knowledgeBaseDialogTarget, setKnowledgeBaseDialogTarget] = useState(
    KNOWLEDGE_BASE_CREATE_NEW,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFiles } = useThreadFileUploader(threadId);
  const { data: providers } = useChatModels();

  const [
    globalModel,
    autoRouting,
    threadMentions,
    threadFiles,
    threadImageToolModel,
    appStoreMutate,
  ] = appStore(
    useShallow((state) => [
      state.chatModel,
      state.autoRouting,
      state.threadMentions,
      state.threadFiles,
      state.threadImageToolModel,
      state.mutate,
    ]),
  );

  const modelInfo = useMemo(() => {
    const provider = providers?.find(
      (provider) => provider.provider === globalModel?.provider,
    );
    const model = provider?.models.find(
      (model) => model.name === globalModel?.model,
    );
    return model;
  }, [providers, globalModel]);

  const supportedFileMimeTypes = modelInfo?.supportedFileMimeTypes;
  const canUploadFiles =
    !supportedFileMimeTypes || supportedFileMimeTypes.length > 0;

  const mentions = useMemo<ChatMention[]>(() => {
    if (!threadId) return [];
    return threadMentions[threadId!] ?? [];
  }, [threadMentions, threadId]);

  const uploadedFiles = useMemo<UploadedFile[]>(() => {
    if (!threadId) return [];
    return threadFiles[threadId] ?? [];
  }, [threadFiles, threadId]);

  const imageToolModel = useMemo(() => {
    if (!threadId) return undefined;
    return threadImageToolModel[threadId];
  }, [threadImageToolModel, threadId]);

  const chatModel = useMemo(() => {
    return model ?? globalModel;
  }, [model, globalModel]);

  const editorRef = useRef<Editor | null>(null);

  // Keep a ref to current input for AssemblyAI callbacks
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  // Initialize AssemblyAI dictation hook
  const { isListening, toggleListening, stopRecording } = useAssemblyAI({
    onTranscript: (text) => {
      const currentInput = inputRef.current;
      const spacer =
        currentInput.length > 0 && !currentInput.endsWith(" ") ? " " : "";
      setInput(currentInput + spacer + text);
    },
    onCommand: (text) => {
      const currentInput = inputRef.current;
      if (text) {
        const spacer =
          currentInput.length > 0 && !currentInput.endsWith(" ") ? " " : "";
        setInput(currentInput + spacer + text);
      }
      // Trigger submit after a short delay to ensure state update
      setTimeout(() => {
        submit();
      }, 100);
    },
  });

  const setChatModel = useCallback(
    (model: ChatModel) => {
      if (setModel) {
        setModel(model);
      } else {
        appStoreMutate({ chatModel: model });
      }
    },
    [setModel, appStoreMutate],
  );

  /**
   * Mirrors a mention list's knowledge sources onto the thread row, which is
   * the durable record. A draft thread has no row yet, so this resolves false
   * and the chat POST writes the same list when it creates the thread; nothing
   * to surface either way.
   *
   * Every path that changes a knowledge-base chip has to call this - the
   * composer menu AND the chip's own remove button. Skipping it on removal
   * left the source on the thread, so a reload brought the chip back and the
   * model kept searching a source the user had detached.
   */
  const persistKnowledgeBases = useCallback(
    (threadId: string, nextMentions: ChatMention[]) => {
      setThreadKnowledgeBasesAction(
        threadId,
        nextMentions
          .filter((m) => m.type === "knowledgeBase")
          .map((m) => ({
            type: m.sourceType,
            id: m.knowledgeBaseId,
            name: m.name,
          })),
      ).catch((error) => {
        console.error("Failed to save the chat's knowledge bases", error);
        toast.error(t("KnowledgeBase.errorAttach"));
      });
    },
    [t],
  );

  const deleteMention = useCallback(
    (mention: ChatMention) => {
      if (!threadId) return;
      const newMentions = mentions.filter((m) => !equal(m, mention));
      appStoreMutate((prev) => ({
        threadMentions: {
          ...prev.threadMentions,
          [threadId!]: newMentions,
        },
      }));
      // Knowledge sources are also stored on the thread, so dropping the chip
      // has to clear the row too or a reload restores it.
      if (mention.type === "knowledgeBase") {
        persistKnowledgeBases(threadId, newMentions);
      }
    },
    [appStoreMutate, mentions, persistKnowledgeBases, threadId],
  );

  const deleteFile = useCallback(
    (fileId: string) => {
      if (!threadId) return;

      // Find file and abort if uploading
      const file = uploadedFiles.find((f) => f.id === fileId);
      if (file?.isUploading && file.abortController) {
        file.abortController.abort();
      }

      // Cleanup preview URL if exists
      if (file?.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }

      appStoreMutate((prev) => {
        const newFiles = uploadedFiles.filter((f) => f.id !== fileId);
        return {
          threadFiles: {
            ...prev.threadFiles,
            [threadId]: newFiles,
          },
        };
      });
    },
    [uploadedFiles, threadId, appStoreMutate],
  );

  const setFileMask = useCallback(
    (fileId: string, mask: UploadedFile["mask"]) => {
      if (!threadId) return;
      appStoreMutate((prev) => ({
        threadFiles: {
          ...prev.threadFiles,
          [threadId]: (prev.threadFiles[threadId] ?? []).map((f) =>
            f.id === fileId ? { ...f, mask } : f,
          ),
        },
      }));
    },
    [threadId, appStoreMutate],
  );

  const applyMask = useCallback(
    async (maskFile: File) => {
      if (!threadId || !maskTarget) return;
      setIsApplyingMask(true);
      try {
        const uploaded = await uploadMaskFile(maskFile);
        if (!uploaded) {
          toast.error(t("MaskEditor.uploadFailed"));
          return;
        }
        setFileMask(maskTarget.id, { url: uploaded.url });
        // A mask only means something to the image tool, so make sure it is
        // bound for this turn; the model choice stays automatic.
        appStoreMutate((prev) => ({
          threadImageToolModel: {
            ...prev.threadImageToolModel,
            [threadId]:
              prev.threadImageToolModel[threadId] ?? AUTO_IMAGE_MODEL_ID,
          },
        }));
        setMaskTarget(null);
      } catch (_err) {
        toast.error(t("MaskEditor.uploadFailed"));
      } finally {
        setIsApplyingMask(false);
      }
    },
    [threadId, maskTarget, uploadMaskFile, setFileMask, appStoreMutate, t],
  );

  // uploadFiles handled by hook

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list) return;
      await uploadFiles(Array.from(list));
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = "";
      setIsUploadDropdownOpen(false);
    },
    [uploadFiles],
  );

  const handleGenerateImage = useCallback(
    (model?: string) => {
      if (!model) {
        appStoreMutate({
          threadImageToolModel: {},
        });
      }
      if (!threadId) return;

      setIsUploadDropdownOpen(false);

      appStoreMutate((prev) => ({
        threadImageToolModel: {
          ...prev.threadImageToolModel,
          [threadId]: model,
        },
      }));

      // Focus on the input
      editorRef.current?.commands.focus();
    },
    [threadId, editorRef],
  );

  const addMention = useCallback(
    (mention: ChatMention) => {
      if (!threadId) return;
      appStoreMutate((prev) => {
        if (mentions.some((m) => equal(m, mention))) return prev;

        const newMentions =
          mention.type == "agent"
            ? [...mentions.filter((m) => m.type !== "agent"), mention]
            : [...mentions, mention];

        return {
          threadMentions: {
            ...prev.threadMentions,
            [threadId!]: newMentions,
          },
        };
      });
    },
    [mentions, threadId],
  );

  const onSelectWorkflow = useCallback(
    (workflow: WorkflowSummary) => {
      addMention({
        type: "workflow",
        name: workflow.name,
        icon: workflow.icon,
        workflowId: workflow.id,
        description: workflow.description,
      });
    },
    [addMention],
  );

  const onSelectSkill = useCallback(
    (skill: { id: string; name: string; description?: string; icon?: any }) => {
      addMention({
        type: "skill",
        name: skill.name,
        icon: skill.icon,
        skillId: skill.id,
        description: skill.description,
      });
    },
    [addMention],
  );

  const attachedKnowledgeBaseIds = useMemo(
    () =>
      mentions
        .filter((m) => m.type === "knowledgeBase")
        .map((m) => m.knowledgeBaseId),
    [mentions],
  );

  const onToggleKnowledgeBase = useCallback(
    (target: KnowledgeBaseTarget, attached: boolean) => {
      if (!threadId) return;

      // The server caps how many sources one turn searches; refusing here is
      // the only way the user learns the extra pick did nothing.
      if (
        attached &&
        !attachedKnowledgeBaseIds.includes(target.id) &&
        attachedKnowledgeBaseIds.length >= MAX_KNOWLEDGE_SOURCES
      ) {
        toast.error(
          t("KnowledgeBase.errorTooMany", { count: MAX_KNOWLEDGE_SOURCES }),
        );
        return;
      }

      const without = mentions.filter(
        (m) => !(m.type === "knowledgeBase" && m.knowledgeBaseId === target.id),
      );
      const next: ChatMention[] = attached
        ? [
            ...without,
            {
              type: "knowledgeBase",
              name: target.name,
              knowledgeBaseId: target.id,
              sourceType: target.sourceType,
            },
          ]
        : without;

      appStoreMutate((prev) => ({
        threadMentions: { ...prev.threadMentions, [threadId]: next },
      }));
      persistKnowledgeBases(threadId, next);
    },
    [
      appStoreMutate,
      attachedKnowledgeBaseIds,
      mentions,
      persistKnowledgeBases,
      t,
      threadId,
    ],
  );

  const openKnowledgeBaseDialog = useCallback((initialTarget: string) => {
    setKnowledgeBaseDialogTarget(initialTarget);
    setIsKnowledgeBaseDialogOpen(true);
  }, []);

  // Whatever the dialog just created or filled is what this chat should search
  // next, so attaching it is the flow's last step rather than a second chore.
  const onKnowledgeBaseDialogDone = useCallback(
    (target: KnowledgeBaseTarget) => onToggleKnowledgeBase(target, true),
    [onToggleKnowledgeBase],
  );

  const onSelectAgent = useCallback(
    (agent: AgentSummary) => {
      appStoreMutate((prev) => {
        return {
          threadMentions: {
            ...prev.threadMentions,
            [threadId!]: [
              {
                type: "agent",
                name: agent.name,
                icon: agent.icon,
                description: agent.description,
                agentId: agent.id,
              },
            ],
          },
        };
      });
    },
    [mentions, threadId],
  );

  const onChangeMention = useCallback(
    (mentions: ChatMention[]) => {
      let hasAgent = false;
      [...mentions]
        .reverse()
        .filter((m) => {
          if (m.type == "agent") {
            if (hasAgent) return false;
            hasAgent = true;
          }

          return true;
        })
        .reverse()
        .forEach(addMention);
    },
    [addMention],
  );

  const submit = () => {
    // Stop voice dictation if it's active
    if (isListening) {
      stopRecording();
    }

    if (isLoading) return;
    if (uploadedFiles.some((file) => file.isUploading)) {
      toast.error("Please wait for files to finish uploading before sending.");
      return;
    }
    const userMessage = input?.trim() || "";
    if (userMessage.length === 0) return;

    // Gate before clearing the composer so the typed text survives a block.
    if (!requireCredits()) return;

    setInput("");
    const attachmentParts = uploadedFiles.reduce<
      Array<FileUIPart | TextUIPart | any>
    >((acc, file) => {
      const isFileSupported = isFilePartSupported(
        file.mimeType,
        supportedFileMimeTypes,
      );
      const link = file.url || file.dataUrl || "";
      if (!link) return acc;
      if (isFileSupported) {
        acc.push({
          type: "file",
          url: link,
          mediaType: file.mimeType,
          filename: file.name,
        } as FileUIPart);
      } else {
        // Use a rich UI part for unsupported file types; will be filtered out for model input
        acc.push({
          type: "source-url",
          url: link,
          title: file.name,
          mediaType: file.mimeType,
        } as any);
      }
      return acc;
    }, []);

    if (attachmentParts.length) {
      const summary = uploadedFiles
        .map((file, index) => {
          const type = file.mimeType || "unknown";
          return `${index + 1}. ${file.name} (${type})`;
        })
        .join("\n");

      attachmentParts.unshift({
        type: "text",
        text: `Attached files:\n${summary}`,
        ingestionPreview: true,
      });
    }

    // Captured before the composer clears its files: the transport reads it
    // from the store when it builds the request, which may be a tick later.
    const maskedFile = uploadedFiles.find((file) => file.mask && file.url);
    appStoreMutate((prev) => ({
      threadImageMask: {
        ...prev.threadImageMask,
        [threadId!]: maskedFile?.mask
          ? { imageUrl: maskedFile.url, maskUrl: maskedFile.mask.url }
          : undefined,
      },
    }));

    sendMessage({
      role: "user",
      parts: [...attachmentParts, { type: "text", text: userMessage }],
    });
    appStoreMutate((prev) => ({
      threadFiles: {
        ...prev.threadFiles,
        [threadId!]: [],
      },
    }));
  };

  // Handle ESC key to clear mentions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        threadId &&
        (mentions.length > 0 || imageToolModel)
      ) {
        e.preventDefault();
        e.stopPropagation();
        appStoreMutate(() => ({
          threadMentions: {},
          agentId: undefined,
          threadImageToolModel: {},
        }));
        editorRef.current?.commands.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mentions.length, threadId, appStoreMutate, imageToolModel]);

  // Drag overlay handled globally in ChatBot

  return (
    <div
      className={cn(
        "mx-auto fade-in animate-in w-full",
        embedded ? "max-w-none" : "max-w-3xl",
      )}
    >
      <div
        className={cn(
          "z-10 mx-auto w-full relative",
          embedded ? "max-w-none" : "max-w-3xl",
        )}
      >
        <fieldset
          className={cn(
            "flex w-full min-w-0 max-w-full flex-col",
            embedded ? "px-0" : "px-4",
          )}
        >
          <div className="shadow-lg overflow-hidden rounded-4xl backdrop-blur-sm transition-all duration-200 bg-muted/60 relative flex w-full flex-col cursor-text z-10 items-stretch focus-within:bg-muted hover:bg-muted focus-within:ring-muted hover:ring-muted">
            {mentions.length > 0 && (
              <div className="bg-input rounded-b-sm rounded-t-3xl p-3 flex flex-col gap-4 mx-2 my-2">
                {mentions.map((mention, i) => {
                  return (
                    <div key={i} className="flex items-center gap-2">
                      {mention.type === "workflow" ||
                      mention.type === "agent" ? (
                        <Avatar
                          className="size-6 p-1 ring ring-border rounded-full flex-shrink-0"
                          style={mention.icon?.style}
                        >
                          <AvatarImage
                            src={
                              mention.icon?.value ||
                              EMOJI_DATA[i % EMOJI_DATA.length]
                            }
                          />
                          <AvatarFallback>
                            {mention.name.slice(0, 1)}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <Button className="size-6 flex items-center justify-center ring ring-border rounded-full flex-shrink-0 p-0.5">
                          {mention.type == "mcpServer" ? (
                            <MCPIcon className="size-3.5" />
                          ) : mention.type == "skill" ? (
                            <Sparkles className="size-3.5" />
                          ) : mention.type == "knowledgeBase" ? (
                            <LibraryBig className="size-3.5" />
                          ) : (
                            <DefaultToolIcon
                              name={mention.name as DefaultToolName}
                              className="size-3.5"
                            />
                          )}
                        </Button>
                      )}

                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-sm font-semibold truncate">
                          {mention.name}
                        </span>
                        {mention.description ? (
                          <span className="text-muted-foreground text-xs truncate">
                            {mention.description}
                          </span>
                        ) : mention.type === "knowledgeBase" ? (
                          <span className="text-muted-foreground text-xs truncate">
                            {t("KnowledgeBase.chipDescription")}
                          </span>
                        ) : null}
                      </div>
                      <Button
                        variant={"ghost"}
                        size={"icon"}
                        disabled={!threadId}
                        className="rounded-full hover:bg-input! flex-shrink-0"
                        onClick={() => {
                          deleteMention(mention);
                        }}
                      >
                        <XIcon />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
            <div
              className={cn(
                "flex flex-col gap-3.5 pt-3 pb-5 md:pt-2 md:pb-4",
                embedded ? "px-3" : "px-5",
              )}
            >
              {/* `text-base` pins the editor at 16px — iOS Safari auto-zooms
                  on focus below that. Taller minimum on small screens so the
                  composer reads as a real writing surface. */}
              <div className="relative text-base min-h-[3rem] md:min-h-[2rem]">
                <ChatMentionInput
                  input={input}
                  onChange={setInput}
                  onChangeMention={onChangeMention}
                  onEnter={submit}
                  placeholder={placeholder ?? t("placeholder")}
                  ref={editorRef}
                  disabledMention={disabledMention}
                  onFocus={onFocus}
                  autofocus={autoFocusInput}
                />
              </div>
              <div
                className={cn(
                  "flex w-full items-center z-30 min-w-0",
                  toolbarCompact ? "gap-0.5" : "gap-1",
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.tar,.gz,.mp3,.wav,.m4a,.ogg,.mp4,.webm,.mov"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                  disabled={!threadId}
                />

                <DropdownMenu
                  open={isUploadDropdownOpen}
                  onOpenChange={setIsUploadDropdownOpen}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={"ghost"}
                      size={"sm"}
                      className={cn(
                        "rounded-full hover:bg-input! data-[state=open]:bg-input! flex-shrink-0",
                        toolbarCompact ? "size-7 p-0 mr-0.5" : "p-2! mr-2",
                      )}
                      disabled={!threadId}
                    >
                      <PlusIcon
                        className={toolbarCompact ? "size-3.5" : undefined}
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  {/* Reserve room for the mobile browser toolbar so the menu is
                      not placed (or flipped) into the area it covers. */}
                  <DropdownMenuContent
                    align="start"
                    side="top"
                    collisionPadding={{ top: 12, bottom: 88 }}
                  >
                    <DropdownMenuItem
                      className="cursor-pointer"
                      disabled={!canUploadFiles}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <PaperclipIcon className="mr-2 size-4" />
                      {t("uploadImage")}
                    </DropdownMenuItem>

                    <KnowledgeBaseMenu
                      attachedIds={attachedKnowledgeBaseIds}
                      onToggle={onToggleKnowledgeBase}
                      onAddDocuments={openKnowledgeBaseDialog}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>

                {maskTarget && (
                  <ImageMaskEditor
                    open
                    imageUrl={maskTarget.url}
                    imageName={maskTarget.name}
                    applying={isApplyingMask}
                    onOpenChange={(open) => {
                      if (!open) setMaskTarget(null);
                    }}
                    onApply={applyMask}
                  />
                )}
                <KnowledgeBaseDialog
                  open={isKnowledgeBaseDialogOpen}
                  onOpenChange={setIsKnowledgeBaseDialogOpen}
                  initialTarget={knowledgeBaseDialogTarget}
                  onDone={onKnowledgeBaseDialogDone}
                />

                {!toolDisabled &&
                  (imageToolModel ? (
                    <Button
                      variant={"ghost"}
                      size={"sm"}
                      className="rounded-full hover:bg-input! p-2! group/image-generator text-primary flex-shrink-0"
                      onClick={() => handleGenerateImage()}
                    >
                      <ImagesIcon className="size-3.5" />
                      {isAutoImageModel(imageToolModel)
                        ? t("imageModelAuto")
                        : resolveImageModel(imageToolModel).name}
                      <XIcon className="size-3 group-hover/image-generator:opacity-100 opacity-0 transition-opacity duration-200" />
                    </Button>
                  ) : (
                    <>
                      <ToolModeDropdown
                        compact={toolbarCompact}
                        className={cn(
                          "flex-shrink-0",
                          toolbarCompact ? "mr-0.5" : "mr-2",
                        )}
                      />
                      <ToolSelectDropdown
                        compact={toolbarCompact}
                        hideToolCount={toolbarCompact}
                        className={cn(
                          "flex-shrink-0 min-w-0",
                          toolbarCompact ? "mr-0.5" : "mr-1 min-[475px]:mr-2",
                        )}
                        align="start"
                        side="top"
                        onSelectWorkflow={onSelectWorkflow}
                        onSelectAgent={onSelectAgent}
                        onSelectSkill={onSelectSkill}
                        onGenerateImage={handleGenerateImage}
                        mentions={mentions}
                        projectId={projectInfo?.id}
                      />
                    </>
                  ))}

                <div className="flex-1 min-w-0" />

                <div className="flex items-center flex-shrink-0 min-w-0">
                  {!embedded && projectInfo && showProjectContextBadge && (
                    <ProjectContextBadge
                      projectId={projectInfo.id}
                      projectName={projectInfo.name}
                      iconOnly
                      className={toolbarCompact ? "mr-0.5" : "mr-1"}
                    />
                  )}

                  {!embedded && contextUsage && (
                    <ChatContextMeter
                      usage={contextUsage}
                      usageModel={contextUsageModel}
                      selectedModel={chatModel}
                      autoRouting={autoRouting}
                      className={toolbarCompact ? "mr-0.5" : "mr-1"}
                    />
                  )}

                  <SelectModel
                    onSelect={setChatModel}
                    currentModel={chatModel}
                    side="top"
                    align="end"
                  >
                    <Button
                      variant={"ghost"}
                      size={"sm"}
                      className={cn(
                        // overflow-hidden matters: the label below is a flex
                        // child whose min-width defaults to min-content, and
                        // with `whitespace-nowrap` from buttonVariants that is
                        // the full model id. Without a clip here a long name
                        // ("gemini-2.5-flash-preview-…") paints straight out of
                        // the max-w box and across the mic and send buttons.
                        "rounded-full group data-[state=open]:bg-input! hover:bg-input! flex-shrink-0 overflow-hidden",
                        toolbarCompact
                          ? "h-7 px-2 mr-0.5 max-w-[72px] sm:max-w-[120px] text-xs"
                          : "mr-2 min-[475px]:mr-3 max-w-[90px] min-[450px]:max-w-[120px] sm:max-w-[180px]",
                      )}
                      data-testid="model-selector-button"
                    >
                      {autoRouting ? (
                        <span
                          className="text-foreground group-data-[state=open]:text-foreground truncate min-w-0"
                          data-testid="selected-model-name"
                        >
                          Automatic
                        </span>
                      ) : chatModel?.model ? (
                        <>
                          {!embedded &&
                            (chatModel.provider === "openai" ? (
                              <OpenAIIcon className="size-3 opacity-0 group-data-[state=open]:opacity-100 group-hover:opacity-100 flex-shrink-0" />
                            ) : chatModel.provider === "xai" ? (
                              <GrokIcon className="size-3 opacity-0 group-data-[state=open]:opacity-100 group-hover:opacity-100 flex-shrink-0" />
                            ) : chatModel.provider === "anthropic" ? (
                              <ClaudeIcon className="size-3 opacity-0 group-data-[state=open]:opacity-100 group-hover:opacity-100 flex-shrink-0" />
                            ) : chatModel.provider === "google" ? (
                              <GeminiIcon className="size-3 opacity-0 group-data-[state=open]:opacity-100 group-hover:opacity-100 flex-shrink-0" />
                            ) : null)}
                          <span
                            className="text-foreground group-data-[state=open]:text-foreground truncate min-w-0"
                            data-testid="selected-model-name"
                          >
                            {chatModel.model}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">model</span>
                      )}

                      <ChevronDown
                        className={cn(
                          "flex-shrink-0",
                          toolbarCompact ? "size-2.5" : "size-3",
                        )}
                      />
                    </Button>
                  </SelectModel>
                </div>

                {/* Mic and send sit side by side so dictation can be stopped
                    and the transcript edited before sending. */}
                <div
                  className={cn(
                    "flex items-center flex-shrink-0",
                    toolbarCompact ? "gap-1" : "gap-1.5 mr-0 min-[450px]:mr-2",
                  )}
                >
                  {!voiceDisabled && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="secondary"
                          onClick={toggleListening}
                          aria-label={
                            isListening
                              ? t("stopDictation")
                              : t("voiceDictation")
                          }
                          className={cn(
                            "rounded-full flex-shrink-0 transition-all duration-200",
                            toolbarCompact ? "size-11" : "size-9",
                            isListening &&
                              "bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/50",
                          )}
                        >
                          {/* A filled square while recording reads as "stop"
                              at a glance, which the pulsing mic did not. */}
                          {isListening ? (
                            <Square
                              className={cn(
                                "fill-current animate-pulse",
                                toolbarCompact ? "size-[18px]" : "size-4",
                              )}
                            />
                          ) : (
                            <MicIcon
                              className={toolbarCompact ? "size-5" : "size-4"}
                            />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isListening ? t("stopDictation") : t("voiceDictation")}
                      </TooltipContent>
                    </Tooltip>
                  )}

                  {isLoading ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="secondary"
                          onClick={onStop}
                          aria-label="Disconnect from the current response"
                          className={cn(
                            "rounded-full flex-shrink-0 text-muted-foreground hover:bg-accent-foreground hover:text-accent transition-all duration-200",
                            toolbarCompact ? "size-11" : "size-9",
                          )}
                        >
                          <Square
                            className={cn(
                              "fill-current",
                              toolbarCompact ? "size-[18px]" : "size-4",
                            )}
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Disconnect</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      size="icon"
                      onClick={submit}
                      disabled={input.trim().length === 0}
                      aria-label={t("sendMessage")}
                      className={cn(
                        "rounded-full flex-shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-200",
                        "disabled:opacity-40 disabled:cursor-not-allowed",
                        toolbarCompact ? "size-11" : "size-9",
                      )}
                    >
                      <CornerRightUp
                        className={toolbarCompact ? "size-5" : "size-4"}
                      />
                    </Button>
                  )}
                </div>
              </div>

              {/* Uploaded Files Preview - Below Input */}
              {uploadedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {uploadedFiles.map((file) => {
                    const isImage = file.mimeType.startsWith("image/");
                    const imageSrc =
                      file.previewUrl || file.url || file.dataUrl || "";
                    const displayName = file.name;
                    const displayExt =
                      file.name.split(".").pop()?.toUpperCase() || "FILE";
                    // Narrower than "we can read this": the button posts to
                    // /api/storage/ingest, which handles CSV only. It used to
                    // show for PDFs, whose request the route rejected.
                    const isSummarizable = isSummarizeSupported(file.mimeType);
                    return (
                      <div
                        key={file.id}
                        className="relative group rounded-lg overflow-hidden border-2 border-border hover:border-primary transition-all"
                      >
                        {isImage ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={imageSrc}
                            alt={file.name}
                            className="w-24 h-24 object-cover"
                          />
                        ) : (
                          <div className="w-32 h-28 flex flex-col items-center justify-center bg-muted px-2 py-3 text-center">
                            <FileIcon className="size-8 text-muted-foreground mb-1" />
                            <span className="text-xs font-medium text-muted-foreground line-clamp-2 w-full">
                              {displayName}
                            </span>
                            <span className="text-[11px] text-muted-foreground/80">
                              {displayExt}
                            </span>
                          </div>
                        )}

                        {/* Upload Progress Overlay */}
                        {file.isUploading && (
                          <div className="absolute inset-0 bg-background/90 flex rounded-lg flex-col items-center justify-center backdrop-blur-sm">
                            <Loader2 className="size-6 animate-spin text-foreground mb-2" />
                            <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary transition-all duration-300"
                                style={{ width: `${file.progress || 0}%` }}
                              />
                            </div>
                            <span className="text-foreground text-xs mt-1">
                              {file.progress || 0}%
                            </span>
                          </div>
                        )}

                        {/* Hover Actions */}
                        <div
                          className={cn(
                            "absolute inset-0 bg-background/80 backdrop-blur-sm transition-opacity flex items-center justify-center rounded-lg",
                            file.isUploading
                              ? "opacity-0"
                              : "opacity-0 group-hover:opacity-100",
                          )}
                        >
                          <div className="flex gap-2 items-center">
                            {isSummarizable && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="secondary"
                                    size="icon"
                                    className="rounded-full"
                                    onClick={async () => {
                                      try {
                                        const url = file.url || file.dataUrl;
                                        if (!url) {
                                          toast.error("No file URL available");
                                          return;
                                        }
                                        const res = await fetch(
                                          "/api/storage/ingest",
                                          {
                                            method: "POST",
                                            headers: {
                                              "Content-Type":
                                                "application/json",
                                            },
                                            body: JSON.stringify({ url }),
                                          },
                                        );
                                        if (!res.ok) {
                                          const e = await res
                                            .json()
                                            .catch(() => ({}));
                                          toast.error(
                                            e.error || "Failed to ingest file",
                                          );
                                          return;
                                        }
                                        const data = await res.json();
                                        // Append preview text to input for the user to send
                                        setInput(
                                          `${input ? input + "\n\n" : ""}${data.text}`,
                                        );
                                      } catch (_err) {
                                        toast.error("Failed to ingest file");
                                      }
                                    }}
                                  >
                                    <FileTextIcon className="size-4" />
                                    <span className="sr-only">Summarize</span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Summarize</TooltipContent>
                              </Tooltip>
                            )}
                            {isImage && file.url && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant={
                                      file.mask ? "default" : "secondary"
                                    }
                                    size="icon"
                                    className="rounded-full"
                                    onClick={() => setMaskTarget(file)}
                                    disabled={file.isUploading}
                                  >
                                    <Paintbrush className="size-4" />
                                    <span className="sr-only">
                                      {t("MaskEditor.open")}
                                    </span>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {file.mask
                                    ? t("MaskEditor.edit")
                                    : t("MaskEditor.open")}
                                </TooltipContent>
                              </Tooltip>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="rounded-full bg-background/80 hover:bg-background"
                              onClick={() => deleteFile(file.id)}
                              disabled={file.isUploading}
                            >
                              <XIcon className="size-4" />
                            </Button>
                          </div>
                        </div>

                        {/* Masked badge: the next send edits only the painted
                            region of this photo. Click removes the mask. */}
                        {file.mask && !file.isUploading && (
                          <button
                            type="button"
                            onClick={() => setFileMask(file.id, undefined)}
                            title={t("MaskEditor.remove")}
                            className="absolute bottom-1 left-1 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground shadow"
                          >
                            <Paintbrush className="size-3" />
                            {t("MaskEditor.badge")}
                          </button>
                        )}

                        {/* Cancel Upload Button (Top Right) */}
                        {file.isUploading && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 size-6 rounded-full bg-background/60 hover:bg-background/80 backdrop-blur-sm"
                            onClick={() => deleteFile(file.id)}
                          >
                            <XIcon className="size-3" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </fieldset>
      </div>
    </div>
  );
}

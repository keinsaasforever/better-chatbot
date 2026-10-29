"use client";

import { MediaPreview } from "@/components/media";
import { useCopy } from "@/hooks/use-copy";
import type { UseChatHelpers } from "@ai-sdk/react";
import { ToolUIPart, UIMessage, getToolName } from "ai";
import { ChatMetadata, ManualToolConfirmTag } from "app-types/chat";
import {
  VercelAIWorkflowToolStreamingResult,
  VercelAIWorkflowToolStreamingResultTag,
} from "app-types/workflow";
import { extractMCPToolId } from "lib/ai/mcp/mcp-tool-id";
import { DefaultToolName, ImageToolName, ResearchToolName } from "lib/ai/tools";
import {
  markdownToHtmlEmail,
  markdownToPlainTextEmail,
} from "lib/email/email-body-format";
import equal from "lib/equal";
import {
  Shortcut,
  getShortcutKeyList,
  isShortcutEvent,
} from "lib/keyboard-shortcuts";
import { cn, safeJSONParse } from "lib/utils";
import {
  processMCPContent,
  processMCPContentEnhanced,
} from "lib/utils/mcp-media-parser";
import {
  Check,
  ChevronDownIcon,
  ChevronRight,
  Copy,
  HammerIcon,
  Loader,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Button } from "ui/button";
import JsonView from "ui/json-view";
import { Separator } from "ui/separator";
import { TextShimmer } from "ui/text-shimmer";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { MCPImageGallery } from "../tool-invocation/mcp-image-gallery";
import { WorkflowInvocation } from "../tool-invocation/workflow-invocation";
import { normalizeRequestInputQuestions } from "@/lib/chat/request-input-questions";
import {
  type CreateAgentOutcome,
  type CreateAgentProposal,
  type RequestInputAnswer,
  CreateAgentReviewUI,
  EmailPreviewUI,
  HITL_TOOL_LABEL_KEYS,
  PlanApprovalUI,
  RequestInputUI,
} from "../tools";
import { useDeleteMessage } from "./shared";

interface ToolMessagePartProps {
  part: ToolUIPart;
  messageId: string;
  threadId?: string;
  showActions: boolean;
  isLast?: boolean;
  isManualToolInvocation?: boolean;
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
  addToolApprovalResponse?: UseChatHelpers<UIMessage>["addToolApprovalResponse"];
  isError?: boolean;
  setMessages?: UseChatHelpers<UIMessage>["setMessages"];
  readonly?: boolean;
  projectId?: string;
  chatStatus?: UseChatHelpers<UIMessage>["status"];
  runStatus?: ChatMetadata["runStatus"];
}

const loading = memo(function Loading() {
  return (
    <div className="px-6 py-4">
      <div className="h-44 w-full rounded-md opacity-0" />
    </div>
  );
});

const PieChart = dynamic(
  () => import("../tool-invocation/pie-chart").then((mod) => mod.PieChart),
  {
    ssr: false,
    loading,
  },
);

const BarChart = dynamic(
  () => import("../tool-invocation/bar-chart").then((mod) => mod.BarChart),
  {
    ssr: false,
    loading,
  },
);

const LineChart = dynamic(
  () => import("../tool-invocation/line-chart").then((mod) => mod.LineChart),
  {
    ssr: false,
    loading,
  },
);

const InteractiveTable = dynamic(
  () =>
    import("../tool-invocation/interactive-table").then(
      (mod) => mod.InteractiveTable,
    ),
  {
    ssr: false,
    loading,
  },
);

const WebSearchToolInvocation = dynamic(
  () =>
    import("../tool-invocation/web-search").then(
      (mod) => mod.WebSearchToolInvocation,
    ),
  {
    ssr: false,
    loading,
  },
);

const DocumentSourcesToolInvocation = dynamic(
  () =>
    import("../tool-invocation/document-sources").then(
      (mod) => mod.DocumentSourcesToolInvocation,
    ),
  {
    ssr: false,
    loading,
  },
);

const CodeExecutor = dynamic(
  () =>
    import("../tool-invocation/code-executor").then((mod) => mod.CodeExecutor),
  {
    ssr: false,
    loading,
  },
);

const ImageGeneratorToolInvocation = dynamic(
  () =>
    import("../tool-invocation/image-generator").then(
      (mod) => mod.ImageGeneratorToolInvocation,
    ),
  {
    ssr: false,
    loading,
  },
);

const ArtifactChip = dynamic(
  () =>
    import("../artifact-panel/artifact-chip").then((mod) => mod.ArtifactChip),
  { ssr: false, loading },
);

const SubagentCard = dynamic(
  () =>
    import("../tool-invocation/subagent-card").then((mod) => mod.SubagentCard),
  { ssr: false, loading },
);

// Local shortcuts for tool invocation approval/rejection
const approveToolInvocationShortcut: Shortcut = {
  description: "approveToolInvocation",
  shortcut: {
    key: "Enter",
    command: true,
  },
};

const rejectToolInvocationShortcut: Shortcut = {
  description: "rejectToolInvocation",
  shortcut: {
    key: "Escape",
    command: true,
  },
};

export const ToolMessagePart = memo(
  ({
    part,
    isLast,
    showActions,
    addToolResult,
    addToolApprovalResponse,
    isError,
    messageId,
    threadId,
    setMessages,
    isManualToolInvocation,
    projectId,
    chatStatus,
    runStatus,
    readonly,
  }: ToolMessagePartProps) => {
    const t = useTranslations("");

    const { output, toolCallId, state, input, errorText } = part;

    const toolName = useMemo(() => getToolName(part), [part.type]);

    const isCompleted = useMemo(() => {
      return state.startsWith("output");
    }, [state]);

    const [expanded, setExpanded] = useState<boolean | null>(null);
    const { copied: copiedInput, copy: copyInput } = useCopy();
    const { copied: copiedOutput, copy: copyOutput } = useCopy();
    const { isDeleting, deleteMessage } = useDeleteMessage(
      messageId,
      setMessages,
    );

    // Handle keyboard shortcuts for approve/reject actions
    useEffect(() => {
      // Only enable shortcuts when manual tool invocation buttons are shown
      if (!isManualToolInvocation) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        const isApprove = isShortcutEvent(e, approveToolInvocationShortcut);
        const isReject = isShortcutEvent(e, rejectToolInvocationShortcut);

        if (!isApprove && !isReject) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (isApprove) {
          addToolResult?.({
            tool: toolName,
            toolCallId,
            output: ManualToolConfirmTag.create({ confirm: true }),
          });
        }

        if (isReject) {
          addToolResult?.({
            tool: toolName,
            toolCallId,
            output: ManualToolConfirmTag.create({ confirm: false }),
          });
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isManualToolInvocation, isLast]);

    const onToolCallDirect = useCallback(
      async (result: any) => {
        if (!addToolResult) {
          throw new Error("Chat result synchronization is unavailable.");
        }
        await addToolResult({
          tool: toolName,
          toolCallId,
          output: result,
        });
      },
      [addToolResult, toolCallId, toolName],
    );

    /**
     * The same handler, but absent wherever a result cannot be sent back.
     *
     * A shared/exported transcript renders these parts with `readonly` and no
     * `addToolResult`. `onToolCallDirect` is a `useCallback`, so it is truthy
     * even then — and `CodeExecutor` executes on mount whenever `onResult` is
     * truthy. Every view of a shared thread therefore re-ran the author's code
     * in a fresh sandbox and then threw "Chat result synchronization is
     * unavailable" as an unhandled rejection. Withholding the callback is what
     * makes the executor render as a transcript instead of running.
     */
    const onToolCallLive = readonly ? undefined : onToolCallDirect;

    const result = useMemo(() => {
      if (state == "output-error") {
        return errorText;
      }
      if (isCompleted) {
        return Array.isArray(output)
          ? {
              ...output,
              content: output.map((node) => {
                // mcp tools
                if (node?.type === "text" && typeof node?.text === "string") {
                  const parsed = safeJSONParse(node.text);
                  return {
                    ...node,
                    text: parsed.success ? parsed.value : node.text,
                  };
                }
                return node;
              }),
            }
          : output;
      }
      return null;
    }, [isCompleted, output, state, errorText]);

    const isWorkflowTool = useMemo(
      () => VercelAIWorkflowToolStreamingResultTag.isMaybe(result),
      [result],
    );

    // Extract media from MCP tool results (enhanced for future MCP servers)
    const mcpContentData = useMemo(() => {
      if (!result || isWorkflowTool)
        return { images: [], cleanedResult: result, mediaResult: null };

      // Check if this is an MCP tool result with content array
      if (
        result &&
        typeof result === "object" &&
        "content" in result &&
        Array.isArray((result as any).content)
      ) {
        // Use enhanced processor for future MCP servers
        const enhancedResult = processMCPContentEnhanced(
          (result as any).content,
          result,
        );

        // Also use legacy processor for backward compatibility
        const { images, cleanedContent } = processMCPContent(
          (result as any).content,
        );

        return {
          images, // Keep for legacy MCPImageGallery
          cleanedResult: {
            ...result,
            content: cleanedContent,
          },
          mediaResult: enhancedResult, // New enhanced media result
        };
      }

      return { images: [], cleanedResult: result, mediaResult: null };
    }, [result, isWorkflowTool]);

    const CustomToolComponent = useMemo(() => {
      // HITL Tool: proposeEmail - Show email preview with approve/reject
      // State is "input-available" (tool called but no execute) or "approval-requested" (if needsApproval was used)
      if (
        toolName === "proposeEmail" &&
        (state === "input-available" || state === "approval-requested")
      ) {
        return (
          <EmailPreviewUI
            to={(input as any)?.to || ""}
            subject={(input as any)?.subject || ""}
            body={(input as any)?.body || ""}
            onApprove={(draft) => {
              // Mail clients render neither markdown nor the model's habitual
              // `**bold**`, so the draft is resolved here: plain text for the
              // fields any email tool understands, HTML for the ones that
              // accept a formatted body.
              const plainBody = markdownToPlainTextEmail(draft.body);
              const htmlBody = markdownToHtmlEmail(draft.body);
              addToolResult?.({
                tool: toolName,
                toolCallId,
                output: {
                  emailHandle: toolCallId,
                  approved: true,
                  timestamp: new Date().toISOString(),
                  // Every field here is what the user approved — recipient,
                  // subject and body are all editable in the card. ALWAYS use
                  // these when sending, never the proposeEmail input fields.
                  approvedTo: draft.to,
                  approvedSubject: draft.subject,
                  approvedBody: plainBody,
                  approvedBodyHtml: htmlBody,
                  bodyFormat: "plain_text",
                  // Aliases matching common Composio/MCP field names for direct passthrough
                  to: draft.to,
                  subject: draft.subject,
                  body: plainBody,
                  recipient_email: draft.to,
                  message_body: plainBody,
                  body_html: htmlBody,
                },
              });
            }}
            onReject={() => {
              addToolResult?.({
                tool: toolName,
                toolCallId,
                output: {
                  approved: false,
                  rejected: true,
                },
              });
            }}
          />
        );
      }

      // A settled proposal keeps its card: the approved draft is the record of
      // what went out, and the raw tool row in its place reads as a glitch.
      if (toolName === "proposeEmail" && state === "output-available") {
        const settled = (output ?? {}) as Record<string, any>;
        return (
          <EmailPreviewUI
            to={settled.approvedTo || (input as any)?.to || ""}
            subject={settled.approvedSubject || (input as any)?.subject || ""}
            body={settled.approvedBody || (input as any)?.body || ""}
            outcome={settled.approved ? "approved" : "rejected"}
          />
        );
      }

      // HITL Tool: askForPlanApproval - Show plan approval with todo list
      // State is "input-available" (tool called but no execute) or "approval-requested" (if needsApproval was used)
      if (
        toolName === "askForPlanApproval" &&
        (state === "input-available" || state === "approval-requested")
      ) {
        return (
          <PlanApprovalUI
            todos={(input as any)?.todos || []}
            explainer={(input as any)?.explainer || ""}
            onApprove={(editedTodos) => {
              addToolResult?.({
                tool: toolName,
                toolCallId,
                output: {
                  approved: true,
                  todos: editedTodos, // User's edited todos
                  explainer: (input as any)?.explainer,
                  planId: toolCallId,
                  message: "Plan approved and ready for execution",
                  timestamp: new Date().toISOString(),
                },
              });
            }}
            onReject={() => {
              addToolResult?.({
                tool: toolName,
                toolCallId,
                output: {
                  approved: false,
                  rejected: true,
                  todos: [],
                },
              });
            }}
            onFeedback={(comment, currentTodos) => {
              addToolResult?.({
                tool: toolName,
                toolCallId,
                output: {
                  approved: false,
                  rejected: false,
                  changesRequested: true,
                  feedback: comment,
                  todos: currentTodos,
                  explainer: (input as any)?.explainer,
                  planId: toolCallId,
                  message:
                    "The user did not approve the plan. Apply their feedback — it may replace the plan entirely — and present the revised plan for approval.",
                  timestamp: new Date().toISOString(),
                },
              });
            }}
          />
        );
      }

      // HITL Tool: createAgent - Review, edit and approve before anything is
      // written. The card performs the agent + schedule writes itself and only
      // then answers the parked call.
      if (
        toolName === "createAgent" &&
        (state === "input-available" || state === "approval-requested")
      ) {
        return (
          <CreateAgentReviewUI
            proposal={(input ?? {}) as CreateAgentProposal}
            threadId={threadId}
            onCreate={(outcome) => {
              addToolResult?.({
                tool: toolName,
                toolCallId,
                output: {
                  ...outcome,
                  timestamp: new Date().toISOString(),
                },
              });
            }}
            onCancel={() => {
              addToolResult?.({
                tool: toolName,
                toolCallId,
                output: {
                  created: false,
                  rejected: true,
                  message:
                    "The user cancelled agent creation. Do not retry unless asked.",
                },
              });
            }}
          />
        );
      }

      // A settled proposal keeps its card, so the thread records what was made.
      if (toolName === "createAgent" && state === "output-available") {
        return (
          <CreateAgentReviewUI
            proposal={(input ?? {}) as CreateAgentProposal}
            outcome={(output ?? { created: false }) as CreateAgentOutcome}
          />
        );
      }

      // HITL Tool: requestInput - Show input collection UI
      // State is "input-available" (tool called but no execute) or "approval-requested" (if needsApproval was used)
      if (
        toolName === "requestInput" &&
        (state === "input-available" || state === "approval-requested")
      ) {
        return (
          <RequestInputUI
            questions={normalizeRequestInputQuestions(input)}
            onSubmit={(answers) => {
              addToolResult?.({
                tool: toolName,
                toolCallId,
                output: {
                  inputReceived: true,
                  answers,
                  // One question is the common case, so expose its answer
                  // directly too rather than making the model index in.
                  value: answers.length === 1 ? answers[0].value : undefined,
                  requestId: toolCallId,
                  timestamp: new Date().toISOString(),
                },
              });
            }}
          />
        );
      }

      // A settled request keeps its card, so the thread records what was asked
      // and what the user answered.
      if (toolName === "requestInput" && state === "output-available") {
        const settled = (output ?? {}) as { answers?: RequestInputAnswer[] };
        return (
          <RequestInputUI
            questions={normalizeRequestInputQuestions(input)}
            submittedAnswers={settled.answers ?? []}
          />
        );
      }

      if (
        toolName === DefaultToolName.WebSearch ||
        toolName === DefaultToolName.WebContent
      ) {
        return <WebSearchToolInvocation part={part} />;
      }

      if (
        toolName === DefaultToolName.AnalyzeDocument ||
        toolName === DefaultToolName.SearchKnowledgeBase
      ) {
        return (
          <DocumentSourcesToolInvocation part={part} projectId={projectId} />
        );
      }

      if (toolName === ImageToolName) {
        return <ImageGeneratorToolInvocation part={part} />;
      }

      if (toolName === DefaultToolName.JavascriptExecution) {
        return (
          <CodeExecutor
            part={part}
            key={part.toolCallId}
            onResult={onToolCallLive}
            threadId={threadId}
            type="javascript"
          />
        );
      }

      if (toolName === DefaultToolName.PythonExecution) {
        return (
          <CodeExecutor
            part={part}
            key={part.toolCallId}
            onResult={onToolCallLive}
            threadId={threadId}
            type="python"
          />
        );
      }

      if (toolName === ResearchToolName) {
        return <SubagentCard key={part.toolCallId} part={part} />;
      }

      if (
        toolName === DefaultToolName.E2BSandbox ||
        toolName === DefaultToolName.EditDocument ||
        toolName === DefaultToolName.CreateTabularReview ||
        toolName === DefaultToolName.CreatePlan ||
        toolName === DefaultToolName.CreatePdf ||
        toolName === DefaultToolName.BrowserAutomation
      ) {
        return (
          <ArtifactChip
            key={part.toolCallId}
            part={part}
            toolName={toolName}
            chatStatus={chatStatus}
            runStatus={runStatus}
            threadId={threadId}
            onResult={
              toolName === DefaultToolName.E2BSandbox
                ? onToolCallLive
                : undefined
            }
          />
        );
      }

      if (state === "output-available") {
        switch (toolName) {
          case DefaultToolName.CreatePieChart:
            return (
              <PieChart key={`${toolCallId}-${toolName}`} {...(input as any)} />
            );
          case DefaultToolName.CreateBarChart:
            return (
              <BarChart key={`${toolCallId}-${toolName}`} {...(input as any)} />
            );
          case DefaultToolName.CreateLineChart:
            return (
              <LineChart
                key={`${toolCallId}-${toolName}`}
                {...(input as any)}
              />
            );
          case DefaultToolName.CreateTable:
            return (
              <InteractiveTable
                key={`${toolCallId}-${toolName}`}
                {...(input as any)}
              />
            );
        }
      }
      return null;
    }, [
      toolName,
      state,
      onToolCallLive,
      result,
      input,
      output,
      addToolResult,
      addToolApprovalResponse,
      toolCallId,
      threadId,
      part,
      chatStatus,
      runStatus,
    ]);

    const { serverName: mcpServerName, toolName: mcpToolName } = useMemo(() => {
      // HITL tools are internal plumbing the user never picked from a menu, so
      // the raw camelCase identifier only leaks implementation when one of
      // them falls through to this generic row (an errored call, say).
      const hitlLabelKey = HITL_TOOL_LABEL_KEYS[toolName];
      if (hitlLabelKey) {
        return { serverName: t(`Chat.${hitlLabelKey}`), toolName: "" };
      }
      return extractMCPToolId(toolName);
    }, [toolName, t]);

    // A failed call is flagged in the header instead of springing the payload
    // open — an error dump is the most developer-facing thing on screen, and a
    // model that recovers on the next attempt leaves it behind as noise.
    const hasError = useMemo(() => {
      return isError || state === "output-error";
    }, [isError, state]);

    // Collapsed by default: the raw request/response payloads are developer
    // detail, so they stay behind the chevron. Workflow timelines are the
    // exception — those are the result, not plumbing.
    const isExpanded = useMemo(() => {
      return expanded ?? isWorkflowTool;
    }, [expanded, isWorkflowTool]);

    const collapsedMediaCount = useMemo(() => {
      if (isExpanded) return 0;
      return (
        mcpContentData.mediaResult?.mediaResources.length ||
        mcpContentData.images.length ||
        0
      );
    }, [isExpanded, mcpContentData]);

    const isExecuting = useMemo(() => {
      if (isWorkflowTool)
        return (
          (result as VercelAIWorkflowToolStreamingResult)?.status == "running"
        );
      return !isCompleted && isLast;
    }, [isWorkflowTool, isCompleted, result, isLast]);

    return (
      <div className="group w-full">
        {CustomToolComponent ? (
          CustomToolComponent
        ) : (
          <div className="flex flex-col fade-in duration-300 animate-in">
            <div
              className="flex gap-2 items-center cursor-pointer group/title"
              onClick={() => setExpanded(!isExpanded)}
            >
              <div className="p-1.5 text-primary bg-input/40 rounded">
                {isExecuting ? (
                  <Loader className="size-3.5 animate-spin" />
                ) : hasError ? (
                  <TriangleAlert className="size-3.5 text-destructive" />
                ) : isWorkflowTool ? (
                  <Avatar className="size-3.5">
                    <AvatarImage
                      src={
                        (result as VercelAIWorkflowToolStreamingResult)
                          .workflowIcon?.value
                      }
                    />
                    <AvatarFallback>
                      {toolName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <HammerIcon className="size-3.5" />
                )}
              </div>
              <span className="font-bold flex items-center gap-2">
                {isExecuting ? (
                  <TextShimmer>{mcpServerName}</TextShimmer>
                ) : (
                  mcpServerName
                )}
              </span>
              {mcpToolName && (
                <>
                  <ChevronRight className="size-3.5" />
                  <span
                    className={cn(
                      "transition-colors duration-300",
                      hasError
                        ? "text-destructive"
                        : "text-muted-foreground group-hover/title:text-primary",
                    )}
                  >
                    {mcpToolName}
                  </span>
                </>
              )}
              <div className="ml-auto group-hover/title:bg-input p-1.5 rounded transition-colors duration-300">
                <ChevronDownIcon
                  className={cn(isExpanded && "rotate-180", "size-3.5")}
                />
              </div>
            </div>
            {(isExpanded ||
              collapsedMediaCount > 0 ||
              isManualToolInvocation) && (
              <div className="flex gap-2 py-2">
                <div className="w-7 flex justify-center">
                  <Separator
                    orientation="vertical"
                    className="h-full bg-gradient-to-t from-transparent to-border to-5%"
                  />
                </div>
                <div className="w-full flex flex-col gap-2">
                  {isExpanded && (
                    <div className="min-w-0 w-full p-4 rounded-lg bg-card px-4 border text-xs transition-colors fade-300">
                      <div className="flex items-center">
                        <h5 className="text-muted-foreground font-medium select-none transition-colors">
                          Request
                        </h5>
                        <div className="flex-1" />
                        {copiedInput ? (
                          <Check className="size-3" />
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-3 text-muted-foreground"
                            onClick={() => copyInput(JSON.stringify(input))}
                          >
                            <Copy className="size-3" />
                          </Button>
                        )}
                      </div>
                      <div className="p-2 max-h-[300px] overflow-y-auto ">
                        <JsonView data={input} />
                      </div>
                    </div>
                  )}
                  {!result || !isExpanded ? null : isWorkflowTool ? (
                    <WorkflowInvocation
                      result={result as VercelAIWorkflowToolStreamingResult}
                    />
                  ) : (
                    <div className="min-w-0 w-full p-4 rounded-lg bg-card px-4 border text-xs mt-2 transition-colors fade-300">
                      <div className="flex items-center">
                        <h5 className="text-muted-foreground font-medium select-none">
                          Response
                        </h5>
                        <div className="flex-1" />
                        {copiedOutput ? (
                          <Check className="size-3" />
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-3 text-muted-foreground"
                            onClick={() => copyOutput(JSON.stringify(result))}
                          >
                            <Copy className="size-3" />
                          </Button>
                        )}
                      </div>
                      {/* Enhanced media preview for future MCP servers */}
                      {mcpContentData.mediaResult &&
                        mcpContentData.mediaResult.mediaResources.length >
                          0 && (
                          <div className="px-2 pb-2">
                            {/* Text content from MCP */}
                            {mcpContentData.mediaResult.textContent && (
                              <div className="text-sm text-muted-foreground p-3 bg-muted/30 rounded-lg mb-3">
                                {mcpContentData.mediaResult.textContent}
                              </div>
                            )}
                            {/* Media preview */}
                            <MediaPreview
                              mediaResources={
                                mcpContentData.mediaResult.mediaResources
                              }
                              groupByType={true}
                            />
                          </div>
                        )}

                      {/* Legacy image gallery for backward compatibility */}
                      {(!mcpContentData.mediaResult ||
                        mcpContentData.mediaResult.mediaResources.length ===
                          0) &&
                        mcpContentData.images.length > 0 && (
                          <div className="px-2 pb-2">
                            <MCPImageGallery images={mcpContentData.images} />
                          </div>
                        )}

                      {/* Raw JSON data */}
                      <div className="p-2 max-h-[300px] overflow-y-auto">
                        <JsonView data={mcpContentData.cleanedResult} />
                      </div>
                    </div>
                  )}

                  {/* Show media preview even when collapsed */}
                  {!isExpanded && (
                    <>
                      {/* Enhanced media preview (future MCP servers) */}
                      {mcpContentData.mediaResult &&
                        mcpContentData.mediaResult.mediaResources.length >
                          0 && (
                          <div className="px-2 pb-2">
                            <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                              <span>🎬</span>
                              <span>
                                {
                                  mcpContentData.mediaResult.mediaResources
                                    .length
                                }{" "}
                                media item
                                {mcpContentData.mediaResult.mediaResources
                                  .length > 1
                                  ? "s"
                                  : ""}
                              </span>
                            </div>
                            <MediaPreview
                              mediaResources={mcpContentData.mediaResult.mediaResources.slice(
                                0,
                                3,
                              )}
                              groupByType={true}
                            />
                            {mcpContentData.mediaResult.mediaResources.length >
                              3 && (
                              <div className="text-xs text-muted-foreground mt-1">
                                +
                                {mcpContentData.mediaResult.mediaResources
                                  .length - 3}{" "}
                                more items (expand to see all)
                              </div>
                            )}
                          </div>
                        )}

                      {/* Legacy image preview (backward compatibility) */}
                      {(!mcpContentData.mediaResult ||
                        mcpContentData.mediaResult.mediaResources.length ===
                          0) &&
                        mcpContentData.images.length > 0 && (
                          <div className="px-2 pb-2">
                            <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                              <span>📷</span>
                              <span>
                                {mcpContentData.images.length} image
                                {mcpContentData.images.length > 1 ? "s" : ""}
                              </span>
                            </div>
                            <MCPImageGallery
                              images={mcpContentData.images.slice(0, 3)}
                            />
                            {mcpContentData.images.length > 3 && (
                              <div className="text-xs text-muted-foreground mt-1">
                                +{mcpContentData.images.length - 3} more images
                                (expand to see all)
                              </div>
                            )}
                          </div>
                        )}
                    </>
                  )}

                  {isManualToolInvocation && (
                    <div className="flex flex-row gap-2 items-center mt-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-full text-xs hover:ring py-2"
                        onClick={() =>
                          addToolResult?.({
                            tool: toolName,
                            toolCallId,
                            output: ManualToolConfirmTag.create({
                              confirm: true,
                            }),
                          })
                        }
                      >
                        <Check />
                        {t("Common.approve")}
                        <Separator orientation="vertical" className="h-4" />
                        <span className="text-muted-foreground">
                          {getShortcutKeyList(
                            approveToolInvocationShortcut,
                          ).join(" ")}
                        </span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full text-xs py-2"
                        onClick={() =>
                          addToolResult?.({
                            tool: toolName,
                            toolCallId,
                            output: ManualToolConfirmTag.create({
                              confirm: false,
                            }),
                          })
                        }
                      >
                        <X />
                        {t("Common.reject")}
                        <Separator orientation="vertical" />
                        <span className="text-muted-foreground">
                          {getShortcutKeyList(
                            rejectToolInvocationShortcut,
                          ).join(" ")}
                        </span>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {showActions && (
              <div className="flex flex-row gap-2 items-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      disabled={isDeleting}
                      onClick={deleteMessage}
                      variant="ghost"
                      size="icon"
                      className="size-3! p-4! opacity-0 group-hover/message:opacity-100 hover:text-destructive"
                    >
                      {isDeleting ? (
                        <Loader className="animate-spin" />
                      ) : (
                        <Trash2 />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-destructive" side="bottom">
                    Delete Message
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
  (prev, next) => {
    if (prev.isError !== next.isError) return false;
    if (prev.isLast !== next.isLast) return false;
    if (prev.showActions !== next.showActions) return false;
    if (prev.isManualToolInvocation !== next.isManualToolInvocation)
      return false;
    if (prev.messageId !== next.messageId) return false;
    if (prev.threadId !== next.threadId) return false;
    if (prev.chatStatus !== next.chatStatus) return false;
    if (prev.runStatus !== next.runStatus) return false;

    const p = prev.part;
    const n = next.part;
    // This part re-renders ~10x/s while the assistant streams. Deep-equalling
    // the full (often large) tool output every time dominates that budget, so
    // gate the deep walk behind cheap identity checks. State, tool id, and
    // error text cover every visible transition; identical input/output object
    // references mean nothing changed.
    if (
      p.state !== n.state ||
      p.toolCallId !== n.toolCallId ||
      p.errorText !== n.errorText
    ) {
      return false;
    }
    if (p.input === n.input && p.output === n.output) {
      return true;
    }
    // References differ but the tool has settled: terminal outputs are immutable
    // in the AI SDK, so a fresh-but-equal object needs no deep compare. Only a
    // still-producing tool can actually change content, so pay for equal() there.
    if (n.state === "output-available" || n.state === "output-error") {
      return true;
    }
    return equal(p, n);
  },
);

ToolMessagePart.displayName = "ToolMessagePart";

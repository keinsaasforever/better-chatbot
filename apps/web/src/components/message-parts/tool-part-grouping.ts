import { type ToolUIPart, type UIMessage, getToolName, isToolUIPart } from "ai";
import { VercelAIWorkflowToolStreamingResultTag } from "app-types/workflow";
import { DefaultToolName, ImageToolName, ResearchToolName } from "lib/ai/tools";

type MessagePart = UIMessage["parts"][number];

/**
 * Tools that render their own purpose-built UI (charts, artifacts, approvals,
 * search results, ...). Those carry the answer itself rather than plumbing, so
 * they always stay visible instead of being folded into a collapsed group.
 */
const DEDICATED_UI_TOOL_NAMES = new Set<string>([
  DefaultToolName.CreatePieChart,
  DefaultToolName.CreateBarChart,
  DefaultToolName.CreateLineChart,
  DefaultToolName.CreateTable,
  DefaultToolName.WebSearch,
  DefaultToolName.WebContent,
  DefaultToolName.AnalyzeDocument,
  DefaultToolName.SearchKnowledgeBase,
  DefaultToolName.QueryProjectGraph,
  DefaultToolName.JavascriptExecution,
  DefaultToolName.PythonExecution,
  DefaultToolName.E2BSandbox,
  DefaultToolName.EditDocument,
  DefaultToolName.CreateTabularReview,
  DefaultToolName.CreatePlan,
  DefaultToolName.BrowserAutomation,
  ResearchToolName,
  ImageToolName,
  "proposeEmail",
  "askForPlanApproval",
  "requestInput",
]);

/**
 * A plain tool call — the raw request/response kind that only clutters the
 * thread when the model chains several of them together.
 */
export function isGroupableToolPart(part: MessagePart): part is ToolUIPart {
  if (!isToolUIPart(part) || part.type === "dynamic-tool") return false;
  if (DEDICATED_UI_TOOL_NAMES.has(getToolName(part))) return false;
  // Workflow runs stream their own step timeline.
  if (
    VercelAIWorkflowToolStreamingResultTag.isMaybe((part as ToolUIPart).output)
  )
    return false;
  return true;
}

export type IndexedMessagePart = { part: MessagePart; index: number };

export type MessageDisplayItem =
  | { kind: "part"; part: MessagePart; index: number }
  | { kind: "tool-group"; parts: IndexedMessagePart[]; index: number };

/**
 * Folds runs of consecutive plain tool calls (and the reasoning interleaved
 * between them) into a single collapsible group. A run of one tool call is left
 * alone — the tool part is already a single line on its own.
 */
export function buildMessageDisplayItems(
  parts: MessagePart[],
  options: { pinnedIndex?: number } = {},
): MessageDisplayItem[] {
  const { pinnedIndex } = options;
  const isGroupable = (index: number) =>
    index !== pinnedIndex && isGroupableToolPart(parts[index]);

  const items: MessageDisplayItem[] = [];
  let i = 0;

  while (i < parts.length) {
    if (!isGroupable(i)) {
      items.push({ kind: "part", part: parts[i], index: i });
      i++;
      continue;
    }

    let cursor = i;
    let toolCount = 0;
    let lastToolIndex = i;
    while (cursor < parts.length) {
      if (isGroupable(cursor)) {
        toolCount++;
        lastToolIndex = cursor;
        cursor++;
        continue;
      }
      const type = parts[cursor].type;
      // Reasoning between two tool calls belongs to the same activity block.
      if (type === "reasoning" || type === "step-start") {
        cursor++;
        continue;
      }
      break;
    }

    if (toolCount < 2) {
      items.push({ kind: "part", part: parts[i], index: i });
      i++;
      continue;
    }

    // Drop anything trailing the last tool call so the reasoning that leads
    // into the assistant's answer stays visible.
    const end = lastToolIndex + 1;
    items.push({
      kind: "tool-group",
      index: i,
      parts: parts
        .slice(i, end)
        .map((part, offset) => ({ part, index: i + offset })),
    });
    i = end;
  }

  return items;
}

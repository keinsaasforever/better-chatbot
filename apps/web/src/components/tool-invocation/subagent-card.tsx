"use client";

import type { ToolUIPart, UIMessage } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDownIcon, Telescope } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { TextShimmer } from "ui/text-shimmer";
import { Markdown } from "../markdown";

// Structural mirrors of ResearchToolOutput (lib/ai/subagents) — declared
// locally so this client component does not import the server module.
interface RunningOutput {
  status: "running";
  message?: UIMessage;
}
interface DoneOutput {
  status: "done";
  summary?: string;
  toolCallCount?: number;
}
type SubagentOutput = RunningOutput | DoneOutput;

const variants = {
  collapsed: { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 },
  expanded: {
    height: "auto",
    opacity: 1,
    marginTop: "0.5rem",
    marginBottom: "0.5rem",
  },
};

export const SubagentCard = memo(function SubagentCard({
  part,
}: {
  part: ToolUIPart;
}) {
  const input = part.input as { task?: string } | undefined;
  const output = part.output as SubagentOutput | undefined;
  const isPreliminary =
    part.state === "output-available" &&
    (part as { preliminary?: boolean }).preliminary === true;
  const isRunning =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    isPreliminary;

  const [isExpanded, setIsExpanded] = useState(false);

  const { progressText, toolActivity } = useMemo(() => {
    if (output?.status === "done") {
      return {
        progressText: output.summary ?? "",
        toolActivity: output.toolCallCount ?? 0,
      };
    }
    const parts =
      output?.status === "running" ? (output.message?.parts ?? []) : [];
    let text = "";
    let tools = 0;
    for (const p of parts) {
      if (p.type === "text" && (p as { text?: string }).text) {
        text = (p as { text: string }).text;
      } else if (p.type.startsWith("tool-")) {
        tools++;
      }
    }
    return { progressText: text, toolActivity: tools };
  }, [output]);

  const task = input?.task ?? "";
  const label = isRunning ? `Researching: ${task}` : `Researched: ${task}`;

  return (
    <div
      className="flex flex-col cursor-pointer px-4 py-1"
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="flex flex-row gap-2 items-center text-ring hover:text-primary transition-colors min-w-0">
        <Telescope className="size-3.5 flex-shrink-0" />
        {isRunning ? (
          <TextShimmer className="truncate">{label}</TextShimmer>
        ) : (
          <div className="font-medium text-sm truncate">{label}</div>
        )}
        {toolActivity > 0 && (
          <span className="text-xs text-muted-foreground flex-shrink-0">
            {toolActivity} lookups
          </span>
        )}
        <button type="button" className="cursor-pointer flex-shrink-0">
          <ChevronDownIcon size={16} />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="content"
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            variants={variants}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
            className="pl-6 text-muted-foreground border-l text-sm"
          >
            <Markdown isStreaming={isRunning}>
              {progressText || (isRunning ? "Working…" : "No findings.")}
            </Markdown>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
SubagentCard.displayName = "SubagentCard";

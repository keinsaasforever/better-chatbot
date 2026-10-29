"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDownIcon } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { TextShimmer } from "ui/text-shimmer";
import { Markdown } from "../markdown";

const variants = {
  collapsed: {
    height: 0,
    opacity: 0,
    marginTop: 0,
    marginBottom: 0,
  },
  expanded: {
    height: "auto",
    opacity: 1,
    marginTop: "1rem",
    marginBottom: "0.5rem",
  },
};
export const ReasoningPart = memo(function ReasoningPart({
  reasoningText,
  isThinking,
}: {
  reasoningText: string;
  isThinking?: boolean;
  readonly?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(isThinking);

  useEffect(() => {
    if (!isThinking && isExpanded) {
      setIsExpanded(false);
    }
  }, [isThinking]);

  return (
    <div
      className="flex flex-col cursor-pointer"
      onClick={() => {
        setIsExpanded(!isExpanded);
      }}
    >
      <div className="flex flex-row gap-2 items-center text-ring hover:text-primary transition-colors">
        {isThinking ? (
          <TextShimmer>Reasoned for a few seconds</TextShimmer>
        ) : (
          <div className="font-medium">Reasoned for a few seconds</div>
        )}

        <button
          data-testid="message-reasoning-toggle"
          type="button"
          className="cursor-pointer"
        >
          <ChevronDownIcon size={16} />
        </button>
      </div>

      <div className="pl-4">
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              data-testid="message-reasoning"
              key="content"
              initial="collapsed"
              animate="expanded"
              exit="collapsed"
              variants={variants}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              style={{ overflow: "hidden" }}
              className="pl-6 text-muted-foreground border-l flex flex-col gap-4"
            >
              <Markdown isStreaming={isThinking}>
                {reasoningText || (isThinking ? "" : "Hmm, let's see...🤔")}
              </Markdown>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});
ReasoningPart.displayName = "ReasoningPart";

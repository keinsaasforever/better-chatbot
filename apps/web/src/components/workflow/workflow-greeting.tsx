"use client";

import { NodeKind } from "lib/ai/workflow/workflow.interface";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { NodeIcon } from "./node-icon";
import {
  BlocksIcon,
  ChevronsLeftRightEllipsisIcon,
  Terminal,
} from "lucide-react";
import { TextShimmer } from "ui/text-shimmer";

export function WorkflowGreeting() {
  const t = useTranslations();
  const descriptions = useMemo(() => {
    return t.raw("Workflow.kindsDescription") ?? {};
  }, [t]);

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">{t("Workflow.title")}</h2>
        <p className="text-muted-foreground">
          {t("Workflow.createWorkflowDescription")}
        </p>
      </div>

      {/* Main content - Two column layout */}
      <div className="grid md:grid-cols-2 gap-8 items-start">
        {/* Left: Explanation */}
        <div className="space-y-4">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">
              <BlocksIcon className="size-4 inline-block mr-2" />
              {t("Workflow.greeting.buildAutomationTitle")}
            </h3>
            <p className="pl-6 text-xs text-muted-foreground leading-relaxed">
              {t("Workflow.greeting.buildAutomationDescription")}
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">
              <Terminal className="size-4 inline-block mr-2" />
              {t("Workflow.greeting.chatbotToolTitle")}
            </h3>
            <p className="pl-6 text-xs text-muted-foreground leading-relaxed">
              {t("Workflow.greeting.chatbotToolDescription")}
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">
              <ChevronsLeftRightEllipsisIcon className="size-4 inline-block mr-2" />
              {t("Workflow.greeting.parameterBasedTitle")}
            </h3>
            <p className="pl-6 text-xs text-muted-foreground leading-relaxed">
              {t("Workflow.greeting.parameterBasedDescription")}
            </p>
          </div>

          <div className="border border-blue-500 bg-blue-500/5 rounded-lg p-4">
            <h4 className="text-xs font-medium text-blue-500 mb-2">
              {t("Workflow.greeting.exampleTitle")}
            </h4>
            <p className="text-xs text-blue-500/50 leading-relaxed">
              {t("Workflow.greeting.exampleDescription")}
            </p>
          </div>
        </div>

        {/* Right: Node Grid */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">
            {t("Workflow.greeting.availableNodesTitle")}
          </h3>

          <div className="grid grid-cols-3 gap-3">
            {Object.keys(NodeKind).map((key) => (
              <Tooltip key={key} delayDuration={200}>
                <TooltipTrigger asChild>
                  <div className="group flex flex-col items-center gap-2 p-3 rounded-lg  hover:bg-accent transition-colors cursor-default">
                    <NodeIcon
                      type={NodeKind[key]}
                      className="ring-4 ring-input/40 group-hover:ring-input group-hover:scale-105 transition-all duration-300"
                    />
                    <span className="text-xs font-medium text-center group-hover:hidden block">
                      {key}
                    </span>
                    <TextShimmer className="text-xs font-medium text-center group-hover:block hidden">
                      {key}
                    </TextShimmer>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-64 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <NodeIcon type={NodeKind[key]} />
                    <span className="text-xs font-semibold">{key}</span>
                  </div>
                  <div className="text-xs whitespace-pre-wrap text-muted-foreground">
                    {descriptions[NodeKind[key]] ??
                      t("Workflow.greeting.soonMessage")}
                  </div>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="text-center pt-4 border-t">
        <p className="text-xs text-muted-foreground">
          {t("Workflow.greeting.ctaMessage")}
        </p>
      </div>
    </div>
  );
}

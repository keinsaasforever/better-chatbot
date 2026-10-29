"use client";

/**
 * Adapted from Vercel AI Elements "Plan"
 * (https://elements.ai-sdk.dev/components/plan), Apache License 2.0,
 * Copyright Vercel, Inc. Local modifications: pure presentational
 * primitives with no AI SDK imports; streaming shimmer via the existing
 * ui/text-shimmer component.
 */

import { cn } from "lib/utils";
import type { ReactNode } from "react";
import { TextShimmer } from "ui/text-shimmer";

export function Plan({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("border rounded-xl bg-card overflow-hidden", className)}>
      {children}
    </div>
  );
}

export function PlanHeader({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1 px-4 py-3 border-b", className)}>
      {children}
    </div>
  );
}

export function PlanTitle({
  isStreaming,
  className,
  children,
}: {
  isStreaming?: boolean;
  className?: string;
  // TextShimmer animates per-character, so the title must be a plain string.
  children: string;
}) {
  return (
    <h3 className={cn("text-sm font-semibold text-foreground", className)}>
      {isStreaming ? <TextShimmer>{children}</TextShimmer> : children}
    </h3>
  );
}

export function PlanDescription({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>{children}</p>
  );
}

export function PlanContent({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return <ol className={cn("flex flex-col py-2", className)}>{children}</ol>;
}

export function PlanStep({
  index,
  title,
  description,
  isStreaming,
}: {
  index: number;
  title: string;
  description?: string;
  isStreaming?: boolean;
}) {
  return (
    <li className="flex gap-3 px-4 py-2">
      <span className="flex-shrink-0 size-5 mt-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-mono font-medium flex items-center justify-center">
        {index}
      </span>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium text-foreground">
          {isStreaming ? <TextShimmer>{title}</TextShimmer> : title}
        </span>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </div>
    </li>
  );
}

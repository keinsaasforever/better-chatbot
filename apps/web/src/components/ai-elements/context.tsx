"use client";

/**
 * Adapted from Vercel AI Elements "Context"
 * (https://elements.ai-sdk.dev/components/context), Apache License 2.0,
 * Copyright Vercel, Inc. Local modifications: typed against the local
 * ContextTokenUsage shape instead of the AI SDK's LanguageModelUsage, SVG
 * ring instead of the tokenlens/Progress dependency, cost estimation
 * removed.
 */

import { formatTokenCount, percentUsed } from "lib/ai/model-context-windows";
import { cn } from "lib/utils";
import {
  type ComponentProps,
  type ReactNode,
  createContext,
  useContext,
} from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";

/**
 * Structural mirror of the AI SDK's LanguageModelUsage so callers can pass
 * ChatMetadata["usage"] without this component importing from "ai".
 */
export type ContextTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  /**
   * Mirrors `LanguageModelUsage.inputTokenDetails`. This row used to read a
   * flat `cachedInputTokens`, which no producer ever wrote - the AI SDK
   * reports cache counts nested here - so "Cached input" was always empty.
   */
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    noCacheTokens?: number;
  };
};

type ContextValue = {
  usedTokens: number;
  maxTokens: number;
  usage?: ContextTokenUsage;
  modelId?: string;
};

/**
 * Whether this instance is driven by touch, and so renders as a Popover rather
 * than a HoverCard. Carried alongside the value so trigger and content agree
 * with the root about which primitive they belong to — mixing a
 * `HoverCardTrigger` into a `Popover` silently renders a panel nothing can
 * open.
 */
type ContextInternalValue = ContextValue & { touch: boolean };

const ContextInternal = createContext<ContextInternalValue | null>(null);

function useContextValue(): ContextInternalValue {
  const value = useContext(ContextInternal);
  if (!value) {
    throw new Error("Context.* components must be used within <Context>");
  }
  return value;
}

export function Context({
  usedTokens,
  maxTokens,
  usage,
  modelId,
  children,
  ...props
}: ContextValue & ComponentProps<typeof HoverCard>) {
  // A HoverCard opens on pointerenter and deliberately ignores touch pointers,
  // because a tap has no hover state to enter. On a phone that left the meter
  // rendered, tappable and completely inert — the context window and prompt
  // usage could not be read at all. Touch gets a click-opened Popover instead;
  // pointer devices keep the hover behaviour, which is better there than
  // requiring a click. Same split, and the same reason, as the Drawer/Popover
  // branch in select-model.tsx.
  const touch = useIsMobile();
  return (
    <ContextInternal.Provider
      value={{ usedTokens, maxTokens, usage, modelId, touch }}
    >
      {touch ? (
        <Popover>{children}</Popover>
      ) : (
        <HoverCard openDelay={100} closeDelay={100} {...props}>
          {children}
        </HoverCard>
      )}
    </ContextInternal.Provider>
  );
}

export function ContextIcon({ className }: { className?: string }) {
  const { usedTokens, maxTokens } = useContextValue();
  const percent = percentUsed(usedTokens, maxTokens);
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("size-3.5", percent >= 90 && "text-destructive", className)}
    >
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        strokeWidth="3"
        className="stroke-muted-foreground/20"
      />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        strokeWidth="3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

export function ContextTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof Button>) {
  const { usedTokens, maxTokens, touch } = useContextValue();
  const percent = percentUsed(usedTokens, maxTokens);
  const button = (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Context window ~${percent}% used`}
      className={cn(
        "rounded-full p-0 hover:bg-input! text-muted-foreground",
        // A bare 14px ring with no number reads as a smudge on a phone, where
        // there is also no hover to hint that it is interactive. Widen it and
        // put the figure on the face.
        touch ? "h-7 gap-1 px-2 text-xs" : "size-7",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <ContextIcon />
          {touch && <span className="tabular-nums">{percent}%</span>}
        </>
      )}
    </Button>
  );
  // Branched rather than picking the component into a variable: a union of two
  // component types has no single compatible call signature, so `<Trigger />`
  // does not typecheck.
  return touch ? (
    <PopoverTrigger asChild>{button}</PopoverTrigger>
  ) : (
    <HoverCardTrigger asChild>{button}</HoverCardTrigger>
  );
}

/**
 * Only the props the meter actually passes are forwarded. HoverCardContent and
 * PopoverContent are both Radix popper content, but their prop types are not
 * interchangeable, so naming the overlap keeps both branches honest.
 */
export function ContextContent({
  className,
  side,
  align,
  children,
}: {
  className?: string;
  side?: ComponentProps<typeof HoverCardContent>["side"];
  align?: ComponentProps<typeof HoverCardContent>["align"];
  children?: ReactNode;
}) {
  const { touch } = useContextValue();
  const merged = cn("w-64 p-3", className);
  return touch ? (
    <PopoverContent className={merged} side={side} align={align}>
      {children}
    </PopoverContent>
  ) : (
    <HoverCardContent className={merged} side={side} align={align}>
      {children}
    </HoverCardContent>
  );
}

export function ContextContentHeader({ className }: { className?: string }) {
  const { usedTokens, maxTokens } = useContextValue();
  const percent = percentUsed(usedTokens, maxTokens);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">
          ~{percent}%
        </span>
        <span className="text-xs font-mono text-muted-foreground">
          {formatTokenCount(usedTokens)} / {formatTokenCount(maxTokens)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full bg-primary",
            percent >= 90 && "bg-destructive",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function ContextContentBody({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return <div className={cn("space-y-2 pt-3", className)}>{children}</div>;
}

function ContextUsageRow({
  label,
  value,
}: {
  label: string;
  value?: number;
}) {
  if (value === undefined) return null;
  return (
    <div className="flex items-center justify-between py-1 px-2 rounded-md bg-muted/30">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono font-medium">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

export function ContextInputUsage() {
  const { usage } = useContextValue();
  return <ContextUsageRow label="Input" value={usage?.inputTokens} />;
}

export function ContextOutputUsage() {
  const { usage } = useContextValue();
  return <ContextUsageRow label="Output" value={usage?.outputTokens} />;
}

export function ContextReasoningUsage() {
  const { usage } = useContextValue();
  return <ContextUsageRow label="Reasoning" value={usage?.reasoningTokens} />;
}

export function ContextCacheUsage() {
  const { usage } = useContextValue();
  return (
    <ContextUsageRow
      label="Cached input"
      value={usage?.inputTokenDetails?.cacheReadTokens}
    />
  );
}

export function ContextContentFooter({ className }: { className?: string }) {
  const { modelId } = useContextValue();
  return (
    <div
      className={cn(
        "mt-3 pt-2 border-t border-border/50 flex items-center justify-between gap-2",
        className,
      )}
    >
      <span className="text-xs text-muted-foreground truncate">{modelId}</span>
      <span className="text-xs text-muted-foreground/70 flex-shrink-0">
        approx.
      </span>
    </div>
  );
}

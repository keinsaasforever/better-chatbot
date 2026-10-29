"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { cn } from "lib/utils";
import { ShareableActions, type Visibility } from "./shareable-actions";
import { WorkflowSummary } from "app-types/workflow";
import { AgentSummary } from "app-types/agent";
import { MCPServerInfo } from "app-types/mcp";
import { MCPIcon } from "ui/mcp-icon";
import Link from "next/link";

export interface ShareableIcon {
  value?: string;
  style?: {
    backgroundColor?: string;
  };
}
interface ShareableCardProps {
  type: "agent" | "workflow" | "mcp";
  item: AgentSummary | WorkflowSummary | MCPServerInfo;
  isOwner?: boolean;
  href: string;
  onBookmarkToggle?: (itemId: string, isBookmarked: boolean) => void;
  onVisibilityChange?: (itemId: string, visibility: Visibility) => void;
  onDelete?: (itemId: string) => void;
  isVisibilityChangeLoading?: boolean;
  isBookmarkToggleLoading?: boolean;
  isDeleteLoading?: boolean;
  actionsDisabled?: boolean;
  /** Extra metadata rendered in the header's date row (e.g. last-run badge). */
  headerMeta?: React.ReactNode;
}

export function ShareableCard({
  type,
  item,
  isOwner = true,
  href,
  onBookmarkToggle,
  onVisibilityChange,
  onDelete,
  isBookmarkToggleLoading,
  isVisibilityChangeLoading,
  isDeleteLoading,
  actionsDisabled,
  headerMeta,
}: ShareableCardProps) {
  const t = useTranslations();
  const isPublished = (item as WorkflowSummary).isPublished;
  const isBookmarked =
    type === "mcp" ? undefined : (item as AgentSummary).isBookmarked;

  return (
    <Link href={href} title={item.name}>
      <Card
        className={cn(
          "w-full min-h-[196px] @container transition-colors group flex flex-col gap-3 cursor-pointer hover:bg-input",
        )}
        data-testid={`${type}-card`}
        data-item-name={item.name}
        data-item-id={item.id}
      >
        <CardHeader className="shrink gap-y-0">
          <CardTitle className="flex gap-3 items-stretch min-w-0">
            <div
              style={{ backgroundColor: item.icon?.style?.backgroundColor }}
              className="p-2 rounded-lg flex items-center justify-center ring ring-background border shrink-0"
            >
              {type === "mcp" ? (
                <MCPIcon className="fill-white size-6" />
              ) : (
                <Avatar className="size-6">
                  <AvatarImage src={item.icon?.value} />
                  <AvatarFallback />
                </Avatar>
              )}
            </div>

            <div className="flex flex-col justify-around min-w-0 flex-1 overflow-hidden">
              <span
                className="truncate font-medium"
                data-testid={`${type}-card-name`}
              >
                {item.name}
              </span>
              <div className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                <time className="shrink-0">
                  {format(item.updatedAt || new Date(), "MMM d, yyyy")}
                </time>
                {type === "workflow" && !isPublished && (
                  <span className="px-2 rounded-sm bg-secondary text-foreground shrink-0">
                    {t("Workflow.draft")}
                  </span>
                )}
                {headerMeta}
              </div>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="min-h-0 grow">
          <CardDescription className="text-xs line-clamp-3 break-words overflow-hidden">
            {item.description}
          </CardDescription>
        </CardContent>

        <CardFooter className="shrink min-h-0 overflow-visible">
          <div className="flex items-center justify-between w-full min-w-0">
            <div onClick={(e) => e.stopPropagation()}>
              <ShareableActions
                type={type}
                visibility={item.visibility}
                isOwner={isOwner}
                isBookmarked={isBookmarked}
                editHref={href}
                onVisibilityChange={
                  onVisibilityChange
                    ? (visibility) => onVisibilityChange(item.id, visibility)
                    : undefined
                }
                onBookmarkToggle={
                  onBookmarkToggle
                    ? (isBookmarked) => onBookmarkToggle(item.id, isBookmarked)
                    : undefined
                }
                onDelete={onDelete ? () => onDelete(item.id) : undefined}
                isBookmarkToggleLoading={isBookmarkToggleLoading}
                isVisibilityChangeLoading={isVisibilityChangeLoading}
                isDeleteLoading={isDeleteLoading}
                disabled={actionsDisabled}
              />
            </div>

            {!isOwner && item.userName && (
              <div className="flex items-center gap-1.5 min-w-0">
                <Avatar className="size-4 ring shrink-0 rounded-full">
                  <AvatarImage src={item.userAvatar || undefined} />
                  <AvatarFallback>
                    {item.userName[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-muted-foreground font-medium truncate min-w-0">
                  {item.userName}
                </span>
              </div>
            )}
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
}

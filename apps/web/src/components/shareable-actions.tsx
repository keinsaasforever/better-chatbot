"use client";

import {
  Lock,
  Eye,
  Globe,
  Bookmark,
  BookmarkCheck,
  Trash2,
  Loader2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Button } from "ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { WriteIcon } from "ui/write-icon";
import { useMemo } from "react";

export type Visibility = "private" | "public" | "readonly";

const VISIBILITY_ICONS = {
  private: Lock,
  readonly: Eye,
  public: Globe,
} as const;

const VISIBILITY_CONFIG = {
  agent: {
    private: {
      label: "Agent.private",
      description: "Agent.privateDescription",
    },
    readonly: {
      label: "Agent.readOnly",
      description: "Agent.readOnlyDescription",
    },
    public: { label: "Agent.public", description: "Agent.publicDescription" },
  },
  workflow: {
    private: {
      label: "Workflow.private",
      description: "Workflow.privateDescription",
    },
    readonly: {
      label: "Workflow.readonly",
      description: "Workflow.readonlyDescription",
    },
    public: {
      label: "Workflow.public",
      description: "Workflow.publicDescription",
    },
  },
  mcp: {
    private: {
      label: "MCP.private",
      description: "MCP.privateDescription",
    },
    public: {
      label: "MCP.featured",
      description: "MCP.featuredDescription",
    },
  },
} as const;

interface ShareableActionsProps {
  type: "agent" | "workflow" | "mcp";
  visibility?: Visibility;
  isOwner: boolean;
  canChangeVisibility?: boolean;
  isBookmarked?: boolean;
  editHref?: string;
  onVisibilityChange?: (visibility: Visibility) => void;
  isVisibilityChangeLoading?: boolean;
  onBookmarkToggle?: (isBookmarked: boolean) => void;
  isBookmarkToggleLoading?: boolean;
  onDelete?: () => void;
  isDeleteLoading?: boolean;
  renderActions?: () => React.ReactNode;
  disabled?: boolean;
}

export function ShareableActions({
  type,
  visibility,
  isOwner,
  canChangeVisibility = true,
  isBookmarked = false,
  editHref,
  onVisibilityChange,
  onBookmarkToggle,
  onDelete,
  renderActions,
  isVisibilityChangeLoading = false,
  isBookmarkToggleLoading = false,
  isDeleteLoading = false,
  disabled = false,
}: ShareableActionsProps) {
  const t = useTranslations();
  const router = useRouter();

  const isAnyLoading = useMemo(
    () =>
      isVisibilityChangeLoading || isBookmarkToggleLoading || isDeleteLoading,
    [isVisibilityChangeLoading, isBookmarkToggleLoading, isDeleteLoading],
  );

  const VisibilityIcon = visibility ? VISIBILITY_ICONS[visibility] : null;

  const visibilityItems = Object.entries(VISIBILITY_CONFIG[type]).map(
    ([value, config]) => {
      const IconComponent =
        VISIBILITY_ICONS[value as keyof typeof VISIBILITY_ICONS];
      return {
        icon: <IconComponent className="size-4" />,
        value: value as Visibility,
        ...config,
      };
    },
  );

  return (
    <div className="flex items-center gap-1">
      {VisibilityIcon && (
        <>
          {isOwner && onVisibilityChange && canChangeVisibility ? (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 data-[state=open]:bg-input text-muted-foreground hover:text-foreground"
                        data-testid="visibility-button"
                        disabled={isAnyLoading || disabled}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        {isVisibilityChangeLoading ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <VisibilityIcon className="size-4" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Change visibility</TooltipContent>
              </Tooltip>
              <DropdownMenuContent className="max-w-sm">
                {visibilityItems.map((visibilityItem) => (
                  <DropdownMenuItem
                    key={visibilityItem.value}
                    className="cursor-pointer"
                    disabled={
                      visibility === visibilityItem.value ||
                      isAnyLoading ||
                      disabled
                    }
                    data-testid={`visibility-${visibilityItem.value}`}
                    onClick={() => onVisibilityChange(visibilityItem.value)}
                  >
                    {visibilityItem.icon}
                    <div className="flex flex-col px-4 gap-1">
                      <p>{t(visibilityItem.label)}</p>
                      <p className="text-xs text-muted-foreground">
                        {t(visibilityItem.description)}
                      </p>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-center size-8">
                  <VisibilityIcon className="size-4 text-muted-foreground" />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {t(VISIBILITY_CONFIG[type][visibility!].label)}
              </TooltipContent>
            </Tooltip>
          )}
        </>
      )}

      {/* Bookmark */}
      {!isOwner && onBookmarkToggle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              data-testid="bookmark-button"
              disabled={isAnyLoading || disabled}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onBookmarkToggle(isBookmarked);
              }}
            >
              {isBookmarkToggleLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : isBookmarked ? (
                <BookmarkCheck className="size-4" />
              ) : (
                <Bookmark className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t(isBookmarked ? "Agent.removeBookmark" : "Agent.addBookmark")}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Edit Action */}
      {isOwner && editHref && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              disabled={isAnyLoading || disabled}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                router.push(editHref);
              }}
            >
              <WriteIcon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("Common.edit")}</TooltipContent>
        </Tooltip>
      )}

      {/* Custom Actions */}
      {isOwner && renderActions && renderActions()}

      {/* Delete Action */}
      {isOwner && onDelete && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              disabled={isAnyLoading || disabled}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
            >
              {isDeleteLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("Common.delete")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

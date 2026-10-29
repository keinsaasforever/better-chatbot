"use client";

import { FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface ProjectContextBadgeProps {
  projectId: string;
  projectName: string;
  documentCount?: number;
  iconOnly?: boolean;
  className?: string;
}

export function ProjectContextBadge({
  projectId,
  projectName,
  documentCount,
  iconOnly = false,
  className,
}: ProjectContextBadgeProps) {
  const tooltipContent = (
    <TooltipContent side="bottom" className="max-w-xs">
      <p className="font-medium mb-1">Project Context Active</p>
      <p className="text-xs text-muted-foreground">
        The knowledge base tool will search documents in "{projectName}"
      </p>
      {documentCount !== undefined && documentCount > 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          {documentCount} documents indexed
        </p>
      )}
      <p className="text-xs text-muted-foreground mt-1">
        Click to return to project overview
      </p>
    </TooltipContent>
  );

  if (iconOnly) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href={`/projects/${projectId}`} className={className}>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 rounded-full p-0 hover:bg-input! flex-shrink-0"
            >
              <FolderOpen className="size-3.5" />
            </Button>
          </Link>
        </TooltipTrigger>
        {tooltipContent}
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={`/projects/${projectId}`} className={className}>
          <Badge
            variant="secondary"
            className={cn(
              "gap-2 px-3 py-1.5 cursor-pointer hover:bg-secondary/80 transition-colors",
            )}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="font-medium">{projectName}</span>
            {documentCount !== undefined && documentCount > 0 && (
              <span className="text-xs text-muted-foreground">
                ({documentCount} docs)
              </span>
            )}
          </Badge>
        </Link>
      </TooltipTrigger>
      {tooltipContent}
    </Tooltip>
  );
}

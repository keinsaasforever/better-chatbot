"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { FileText, MoreVertical, Download, Trash } from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/lib/utils";
import { openProjectDocument } from "@/lib/citations/open-project-document";
import { EmbeddingStatusIndicator } from "./embedding-status";

interface DocumentCardProps {
  document: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    createdAt: Date;
    embeddingStatus?: "pending" | "processing" | "completed" | "failed";
    chunkCount?: number;
    pageCount?: number;
  };
  projectId: string;
  onDelete?: () => void;
}

function formatRelative(date: Date): string {
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInDays === 0) return "Today";
  if (diffInDays === 1) return "Yesterday";
  if (diffInDays < 7) return `${diffInDays} days ago`;
  if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
  if (diffInDays < 365) return `${Math.floor(diffInDays / 30)} months ago`;
  return `${Math.floor(diffInDays / 365)} years ago`;
}

function FileIcon({ type: _type }: { type: string }) {
  // You can expand this with different icons based on mime type
  return <FileText className="w-10 h-10 text-blue-500" />;
}

export function DocumentCard({
  document,
  projectId,
  onDelete,
}: DocumentCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (
      !confirm(`Delete "${document.filename}"? This action cannot be undone.`)
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      await fetch(`/api/projects/${projectId}/documents/${document.id}`, {
        method: "DELETE",
      });
      onDelete?.();
    } catch (_error) {
      toast.error("Failed to delete document");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDownload = async () => {
    await openProjectDocument(projectId, document.id);
  };

  return (
    <Card className="group hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        {/* Document Icon & Name */}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <FileIcon type={document.contentType} />
          </div>

          <div className="flex-1 min-w-0">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <h3 className="font-medium text-sm truncate">
                    {document.filename}
                  </h3>
                </TooltipTrigger>
                <TooltipContent>{document.filename}</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
              <span>{formatBytes(document.size)}</span>
              {document.pageCount && (
                <>
                  <span>•</span>
                  <span>{document.pageCount} pages</span>
                </>
              )}
            </div>
          </div>

          {/* Actions Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleDownload}>
                <Download className="w-4 h-4 mr-2" />
                Download
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                <Trash className="w-4 h-4 mr-2" />
                {isDeleting ? "Deleting..." : "Delete"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Embedding Status */}
        {document.embeddingStatus && (
          <div className="mt-3 pt-3 border-t">
            <EmbeddingStatusIndicator status={document.embeddingStatus} />

            {document.embeddingStatus === "completed" &&
              document.chunkCount != null &&
              document.chunkCount > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {document.chunkCount} chunks indexed
                </p>
              )}
          </div>
        )}

        {/* Upload Date */}
        <p className="text-xs text-muted-foreground mt-2">
          Uploaded {formatRelative(document.createdAt)}
        </p>
      </CardContent>
    </Card>
  );
}

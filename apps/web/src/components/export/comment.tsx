"use client";

import { ChatExportCommentWithUser } from "app-types/chat-export";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Button } from "ui/button";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

import { mutate } from "swr";
import MentionInput from "../mention-input";
import { CornerDownRightIcon } from "lucide-react";
import { notify } from "lib/notify";

export default function Comment({
  comment,
  exportId,
  depth = 0,
  maxReplyDepth = Infinity,
  onReply,
}: {
  comment: ChatExportCommentWithUser;
  exportId: string;
  depth?: number;
  maxReplyDepth?: number;
  onReply?: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    const answer = await notify.confirm({
      title: "Delete Comment",
      description: "Are you sure you want to delete this comment?",
    });
    if (!answer) return;

    try {
      setIsDeleting(true);
      const response = await fetch(
        `/api/export/${exportId}/comments/${comment.id}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error("Failed to delete comment");
      }
      // Refresh comments
      mutate(`/api/export/${exportId}/comments`);
    } catch (error) {
      console.error("Failed to delete comment:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex items-start gap-3">
      <Avatar className="size-6 rounded-full">
        <AvatarImage src={comment.authorImage} />
        <AvatarFallback>
          {comment.authorName?.[0]?.toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-xs">{comment.authorName}</span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(comment.createdAt), {
              addSuffix: true,
            })}
          </span>
        </div>

        <div className="text-sm">
          <MentionInput content={comment.content} disabled className="p-0" />
        </div>

        <div className="flex items-center text-muted-foreground gap-2">
          {depth < maxReplyDepth && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onReply?.()}
              className="text-xs! p-0! hover:bg-transparent!"
            >
              <CornerDownRightIcon className="size-3" />
              Reply
            </Button>
          )}

          {comment.isOwner && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
              className="text-xs! hover:text-destructive p-0! hover:bg-transparent!"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          )}
        </div>

        {/* Render replies */}
        {comment.replies && comment.replies.length > 0 && (
          <div className="mt-2 border-l-1 border-border/30 pl-4">
            {comment.replies.map((reply) => (
              <Comment
                key={reply.id}
                comment={reply}
                exportId={exportId}
                maxReplyDepth={maxReplyDepth}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

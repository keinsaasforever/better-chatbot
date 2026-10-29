"use client";

import CommentForm from "./comment-form";
import Comment from "./comment";
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "ui/drawer";
import { useMemo, useRef, useState } from "react";
import { CornerDownRightIcon, MessagesSquareIcon, XIcon } from "lucide-react";
import { Button } from "ui/button";
import useSWR, { mutate } from "swr";
import { fetcher, truncateString } from "lib/utils";
import { ChatExportCommentWithUser } from "app-types/chat-export";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Skeleton } from "ui/skeleton";
import { authClient } from "auth/client";
import { notify } from "lib/notify";
import { useRouter } from "next/navigation";

function deepReplyCount(comment: ChatExportCommentWithUser): number {
  if (comment.replies?.length) {
    return comment.replies.reduce((acc, reply) => {
      return acc + deepReplyCount(reply);
    }, 1);
  }
  return 1; // original comment
}

export default function Comments({
  id,
  children,
  defaultComments,
}: {
  id: string;
  children?: React.ReactNode;
  defaultComments: ChatExportCommentWithUser[];
}) {
  const { data: session, isPending } = authClient.useSession();

  const isLoggedIn = !!session?.user?.id;

  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [replyTo, setReplyTo] = useState<ChatExportCommentWithUser | null>(
    null,
  );

  const router = useRouter();

  const { data, isLoading } = useSWR<ChatExportCommentWithUser[]>(
    isLoggedIn ? `/api/export/${id}/comments` : null,
    fetcher,
    {
      fallbackData: defaultComments,
      revalidateOnMount: false,
    },
  );

  const trigger = useMemo(() => {
    if (children) return children;

    const commentCount = data?.length
      ? data.map(deepReplyCount).reduce((acc, count) => acc + count, 0)
      : 0;
    return (
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        disabled={isPending}
        data-testid="comments-trigger"
      >
        <MessagesSquareIcon />
        {commentCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs rounded-full h-5 w-5 flex items-center justify-center">
            {commentCount}
          </span>
        )}
      </Button>
    );
  }, [children, data, isPending]);

  const handleOpenChange = (open: boolean) => {
    if (!isLoggedIn) {
      notify
        .confirm({
          title: "Sign in required",
          description:
            "You need to sign in to view comments. Would you like to go to the sign-in page?",
        })
        .then((answer) => {
          if (answer) {
            router.push("/sign-in");
          }
        });
    } else {
      setOpen(open);
    }
  };

  const handleReplySubmit = async () => {
    setReplyTo(null);
    await mutate(`/api/export/${id}/comments`);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  return (
    <Drawer
      handleOnly
      direction="right"
      modal
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>

      <DrawerContent
        className="select-text! w-full lg:w-md border-none! bg-transparent! p-4"
        disableOverlay
      >
        <DrawerTitle className="sr-only">Comments</DrawerTitle>

        <div className="overflow-hidden w-full h-full flex flex-col bg-secondary/40 backdrop-blur-sm rounded-lg border">
          <div className="flex items-center justify-end p-2">
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
              <XIcon />
            </Button>
          </div>

          <div
            className="flex-1 overflow-y-auto p-4 pt-0 space-y-4"
            ref={scrollRef}
          >
            {isLoading ? (
              <>
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </>
            ) : data?.length === 0 ? (
              <div
                className="text-center py-8 h-full flex justify-center items-center"
                data-testid="comments-empty"
              >
                <p className="text-muted-foreground">
                  Be the first to comment!
                </p>
              </div>
            ) : (
              data?.map((comment) => (
                <Comment
                  key={comment.id}
                  comment={comment}
                  exportId={id}
                  maxReplyDepth={1}
                  onReply={() => setReplyTo(comment)}
                />
              ))
            )}
          </div>

          <div className="border-t border-border  p-4 bg-background flex flex-col gap-2">
            {replyTo && (
              <div className="flex items-center text-xs text-muted-foreground gap-1">
                <CornerDownRightIcon className="size-3" />
                <Avatar className="size-3 rounded-full">
                  <AvatarImage src={replyTo.authorImage} />
                  <AvatarFallback>
                    {replyTo.authorName?.[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                Replying to
                <span className="text-primary">
                  {truncateString(replyTo.authorName, 8)}
                </span>{" "}
                <XIcon
                  className="ml-auto size-2.5 cursor-pointer hover:text-primary"
                  onClick={() => setReplyTo(null)}
                />
              </div>
            )}
            <CommentForm
              exportId={id}
              parentId={replyTo?.id}
              onSubmit={handleReplySubmit}
            />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

"use client";

import {
  type NotificationItem,
  useNotifications,
} from "@/hooks/queries/use-notifications";
import { formatDistanceToNow } from "date-fns";
import { cn } from "lib/utils";
import { AlertCircle, Bell, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

function NotificationIcon({ type }: { type: string }) {
  if (type.endsWith("failure") || type.endsWith("error")) {
    return <AlertCircle className="size-4 text-destructive shrink-0" />;
  }
  return <CheckCircle2 className="size-4 text-green-500 shrink-0" />;
}

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: NotificationItem;
  onOpen: (notification: NotificationItem) => void;
}) {
  const content = (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-secondary/60",
        !notification.readAt && "bg-secondary/30",
      )}
    >
      <NotificationIcon type={notification.type} />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span
          className={cn(
            "text-sm truncate",
            !notification.readAt && "font-medium",
          )}
        >
          {notification.title}
        </span>
        {notification.body && (
          <span className="text-xs text-muted-foreground line-clamp-2">
            {notification.body}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(notification.createdAt), {
            addSuffix: true,
          })}
        </span>
      </div>
      {!notification.readAt && (
        <span className="ml-auto mt-1 size-2 shrink-0 rounded-full bg-primary" />
      )}
    </div>
  );

  const href =
    notification.url ??
    (notification.threadId ? `/chat/${notification.threadId}` : null);

  if (href) {
    return (
      <Link href={href} onClick={() => onOpen(notification)}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="w-full"
      onClick={() => onOpen(notification)}
    >
      {content}
    </button>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markRead, markAllRead } =
    useNotifications();

  const handleOpenNotification = (notification: NotificationItem) => {
    if (!notification.readAt) {
      markRead([notification.id]);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              size={"icon"}
              variant={"ghost"}
              className="bg-secondary/40 relative"
              aria-label="Notifications"
              data-testid="notification-bell"
            >
              <Bell className="size-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent align="end" side="bottom">
          <span className="text-xs">Notifications</span>
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-sm font-medium">Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => markAllRead()}
            >
              Mark all read
            </Button>
          )}
        </div>
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing new. Scheduled agent runs will show up here.
            </p>
          ) : (
            notifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onOpen={handleOpenNotification}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

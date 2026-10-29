"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Button } from "ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "ui/card";
import { Badge } from "ui/badge";
// import { cn } from "lib/utils";
import {
  ShareableActions,
  type Visibility,
} from "@/components/shareable-actions";
import { useTranslations } from "next-intl";
import { redriectMcpOauth } from "lib/ai/mcp/oauth-redirect";
import type { MCPServerInfo } from "app-types/mcp";

interface McpShareableCardProps {
  item: MCPServerInfo;
  isOwner: boolean;
  onVisibilityChange?: (visibility: Visibility) => void;
  onDelete?: () => void;
  onAuthSuccess?: () => void;
}

export function McpShareableCard({
  item,
  isOwner,
  onVisibilityChange,
  onDelete,
  onAuthSuccess,
}: McpShareableCardProps) {
  const t = useTranslations("");
  const [authLoading, setAuthLoading] = useState(false);

  const toolsCount = item.toolInfo?.length ?? 0;
  const kind = useMemo(
    () => ("url" in item.config ? "remote" : "stdio"),
    [item.config],
  );

  const statusPill = useMemo(() => {
    const label = t(`MCP.status.${item.status}`);
    const variantMap = {
      connected: "default",
      authorizing: "secondary",
      loading: "secondary",
      disconnected: "outline",
    } as const;
    return (
      <Badge
        variant={variantMap[item.status]}
        className="rounded-full px-2 py-0 text-xs"
      >
        {label}
      </Badge>
    );
  }, [item.status, t]);

  const authorize = useCallback(async () => {
    try {
      setAuthLoading(true);
      await redriectMcpOauth(item.id);
      // Trigger dashboard refresh after successful OAuth
      onAuthSuccess?.();
    } finally {
      setAuthLoading(false);
    }
  }, [item.id, onAuthSuccess]);

  return (
    <Card className="w-full min-h-[196px] @container transition-colors group flex flex-col gap-3">
      <CardHeader className="shrink gap-y-0">
        <CardTitle className="flex gap-3 items-stretch min-w-0">
          <div className="flex flex-col justify-around min-w-0 flex-1 overflow-hidden">
            <span className="truncate font-medium">{item.name}</span>
            <div className="text-xs text-muted-foreground flex items-center gap-2 min-w-0">
              {statusPill}
              <span>•</span>
              <span className="truncate">{t(`MCP.kind.${kind}`)}</span>
              <span>•</span>
              <span>{t("MCP.toolsCount", { count: toolsCount })}</span>
            </div>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="min-h-0 grow" />

      <CardFooter className="shrink min-h-0 overflow-visible">
        <div className="flex items-center justify-between w-full min-w-0">
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1"
          >
            {isOwner ? (
              <ShareableActions
                type="mcp"
                visibility={item.visibility}
                isOwner={true}
                editHref={`/mcp/modify/${item.id}`}
                onVisibilityChange={onVisibilityChange}
                onDelete={onDelete}
              />
            ) : (
              <ShareableActions
                type="mcp"
                isOwner={false}
                visibility={item.visibility}
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            {item.status === "authorizing" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  authorize();
                }}
                disabled={authLoading}
              >
                {t("MCP.authorize")}
              </Button>
            )}
            {!isOwner && (
              <Link href={`/mcp/test/${item.id}`}>
                <Button size="sm" variant="ghost">
                  {t("MCP.toolsTest")}
                </Button>
              </Link>
            )}
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}

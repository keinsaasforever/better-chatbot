"use client";
import { McpToolCustomization, MCPToolInfo } from "app-types/mcp";
import { PropsWithChildren, ReactNode, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "ui/dialog";
import { Separator } from "ui/separator";
import JsonView from "ui/json-view";
import { Textarea } from "ui/textarea";
import { Button } from "ui/button";
import { Pencil, Trash2, Loader, Info } from "lucide-react";
import { safe } from "ts-safe";
import { handleErrorWithToast } from "ui/shared-toast";
import useSWR from "swr";
import { cn, fetcher } from "lib/utils";
import { useTranslations } from "next-intl";
import { Skeleton } from "ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "ui/tooltip";

import { z } from "zod";

// Helper function to check if schema is empty
const isEmptySchema = (schema: any): boolean => {
  if (!schema) return true;
  // Check properties first if available, otherwise check the schema itself
  const dataToCheck = schema.properties || schema;
  return Object.keys(dataToCheck).length === 0;
};

export const ToolDetailPopup = ({
  tool,
  children,
  serverId,
  onUpdate,
}: PropsWithChildren<{
  onUpdate?: () => void;
  tool: MCPToolInfo;
  serverId: string;
}>) => {
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogPortal>
        <DialogContent className="sm:max-w-[800px] fixed p-10 overflow-hidden">
          <ToolDetailPopupContent
            onUpdate={onUpdate}
            tool={tool}
            serverId={serverId}
          />
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
};

const createApiUrl = (serverId: string, toolName: string) =>
  `/api/mcp/tool-customizations/${serverId}/${toolName}`;

export function ToolDetailPopupContent({
  tool,
  title,
  serverId,
  onUpdate,
}: {
  onUpdate?: () => void;
  tool: MCPToolInfo;
  title?: ReactNode;
  serverId: string;
}) {
  const t = useTranslations();

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>("");
  const [processing, setProcessing] = useState(false);

  const { data, isLoading, mutate } = useSWR<McpToolCustomization | null>(
    createApiUrl(serverId, tool.name),
    fetcher,
  );

  const startEdit = (e: any) => {
    e.stopPropagation();
    setValue(data?.prompt ?? "");
    setEditing(true);
  };

  const handleSave = () => {
    setProcessing(true);
    safe(() =>
      z
        .object({
          prompt: z.string().min(1).max(1000),
        })
        .parse({
          prompt: value,
        }),
    )
      .map((body) =>
        fetch(createApiUrl(serverId, tool.name), {
          method: "POST",
          body: JSON.stringify(body),
        }),
      )
      .ifOk(() => {
        mutate();
        onUpdate?.();
      })
      .ifFail(handleErrorWithToast)
      .watch(() => {
        setEditing(false);
        setProcessing(false);
      });
  };

  const handleDelete = () => {
    setProcessing(true);
    safe(() =>
      fetch(createApiUrl(serverId, tool.name), {
        method: "DELETE",
      }),
    )
      .ifOk(() => {
        mutate();
        onUpdate?.();
      })
      .ifFail(handleErrorWithToast)
      .watch(() => {
        setEditing(false);
        setProcessing(false);
      });
  };
  return (
    <div className="flex flex-col overflow-y-auto h-[70vh]">
      <DialogHeader>
        <DialogTitle>{title || tool.name}</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground mt-4">
          {tool.description}
        </DialogDescription>
      </DialogHeader>
      <Separator className="my-4" />
      <div>
        <div className="flex items-center mb-1">
          <h5 className="mr-auto">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs font-medium flex-1 flex items-center">
                  {t("MCP.additionalInstructions")}
                  <Info className="size-3 ml-1 text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="whitespace-pre-wrap">
                  {t("MCP.toolCustomizationInstructions")}
                </p>
              </TooltipContent>
            </Tooltip>
          </h5>
          {processing || isLoading ? (
            <Button size="icon" variant="ghost">
              <Loader className="size-3 animate-spin" />
            </Button>
          ) : (
            <>
              {data?.id && !editing && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" onClick={handleDelete}>
                      <Trash2 className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("Common.delete")}</TooltipContent>
                </Tooltip>
              )}
              {!editing && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={startEdit}
                      aria-label="Edit instructions"
                    >
                      <span className="sr-only">Edit</span>
                      <Pencil className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("Common.edit")}</TooltipContent>
                </Tooltip>
              )}
            </>
          )}
        </div>

        {isLoading ? (
          <Skeleton className="w-full h-4" />
        ) : editing ? (
          <div className="my-2">
            <Textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-full max-h-[120px] resize-none"
            />
            <div className="flex gap-2 justify-end mt-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                {t("Common.cancel")}
              </Button>

              <Button size="sm" onClick={handleSave}>
                {t("Common.save")}
              </Button>
            </div>
          </div>
        ) : (
          <p
            className={cn(
              !data?.prompt && "italic",
              "text-xs text-muted-foreground whitespace-pre-wrap break-words max-h-[120px] overflow-y-auto",
            )}
          >
            {data?.prompt || "None"}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 my-4">
        <h5 className="text-xs font-medium">{t("MCP.inputSchema")}</h5>
      </div>
      {tool.inputSchema ? (
        <div className="overflow-y-auto max-h-[40vh] bg-card card p-4 rounded">
          {!isEmptySchema(tool.inputSchema) ? (
            <JsonView data={tool.inputSchema?.properties || tool.inputSchema} />
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {t("MCP.noSchemaPropertiesAvailable")}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          {t("MCP.noSchemaPropertiesAvailable")}
        </p>
      )}

      <div className="absolute left-0 right-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent pointer-events-none z-10" />
    </div>
  );
}

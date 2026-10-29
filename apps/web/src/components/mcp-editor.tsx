"use client";
import { useState, useMemo } from "react";
import {
  MCPServerConfig,
  MCPRemoteConfigZodSchema,
  MCPStdioConfigZodSchema,
  Visibility,
  // VisibilityZodSchema,
} from "app-types/mcp";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import JsonView from "./ui/json-view";
import { safe } from "ts-safe";
import { useRouter } from "next/navigation";
import { createDebounce, fetcher, isNull, safeJSONParse } from "lib/utils";
import { handleErrorWithToast } from "ui/shared-toast";
import { mutate } from "swr";
import { analytics } from "@/lib/analytics/posthog";
import { Loader, InfoIcon, HelpCircle, ExternalLink } from "lucide-react";
import {
  isMaybeMCPServerConfig,
  isMaybeRemoteConfig,
} from "lib/ai/mcp/is-mcp-config";

import { Alert, AlertDescription, AlertTitle } from "ui/alert";
import { z } from "zod";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Switch } from "./ui/switch";

interface MCPEditorProps {
  initialConfig?: MCPServerConfig;
  name?: string;
  id?: string;
  initialVisibility?: Visibility;
}

const SMITHERY_TEMPLATE = `{
  "url": ""
}`;

const STDIO_ARGS_ENV_PLACEHOLDER = `/** Remote Server (Smithery/MCP Hub) - Most Common */
{
  "url": "https://server.smithery.ai/@username/server-name/mcp"
}

/** STDIO Example (Local/Advanced) */
{
  "command": "node", 
  "args": ["index.js"],
  "env": {
    "OPENAI_API_KEY": "sk-..."
  }
}

/** Remote with Headers (API Keys) */
{
  "url": "https://api.example.com",
  "headers": {
    "Authorization": "Bearer sk-..."
  }
}`;

export default function MCPEditor({
  initialConfig,
  name: initialName,
  id,
  initialVisibility = "private",
}: MCPEditorProps) {
  const t = useTranslations();
  const shouldInsert = useMemo(() => isNull(id), [id]);

  const [isLoading, setIsLoading] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const errorDebounce = useMemo(() => createDebounce(), []);

  // State for form fields
  const [name, setName] = useState<string>(initialName ?? "");
  const [visibility, setVisibility] = useState<Visibility>(initialVisibility);
  const router = useRouter();
  const [config, setConfig] = useState<MCPServerConfig>(
    initialConfig as MCPServerConfig,
  );
  const [jsonString, setJsonString] = useState<string>(
    initialConfig ? JSON.stringify(initialConfig, null, 2) : SMITHERY_TEMPLATE,
  );

  // Simple mode: URL input
  const [simpleMode, setSimpleMode] = useState<boolean>(
    !initialConfig ||
      (initialConfig && "url" in initialConfig && !initialConfig.headers),
  );
  const [urlInput, setUrlInput] = useState<string>(
    initialConfig && "url" in initialConfig ? initialConfig.url : "",
  );

  // Name validation schema
  const nameSchema = z.string().regex(/^[a-zA-Z0-9\-]+$/, {
    message: t("MCP.nameMustContainOnlyAlphanumericCharactersAndHyphens"),
  });

  const validateName = (nameValue: string): boolean => {
    const result = nameSchema.safeParse(nameValue);
    if (!result.success) {
      setNameError(
        t("MCP.nameMustContainOnlyAlphanumericCharactersAndHyphens"),
      );
      return false;
    }
    setNameError(null);
    return true;
  };

  const saveDisabled = useMemo(() => {
    return (
      name.trim() === "" ||
      isLoading ||
      !!jsonError ||
      !!nameError ||
      !isMaybeMCPServerConfig(config)
    );
  }, [isLoading, jsonError, nameError, config, name]);

  // Handle URL input change (simple mode)
  const handleUrlChange = (url: string) => {
    setUrlInput(url);
    errorDebounce(() => {
      if (url.trim() === "") {
        setConfig({} as MCPServerConfig);
        setJsonError("URL is required");
        setJsonString(SMITHERY_TEMPLATE);
        return;
      }

      try {
        new URL(url); // Validate URL format
        const newConfig = { url: url.trim() };
        setConfig(newConfig as MCPServerConfig);
        setJsonString(JSON.stringify(newConfig, null, 2));
        setJsonError(null);
      } catch {
        setJsonError("Invalid URL format");
      }
    }, 300);
  };

  // Validate
  const validateConfig = (jsonConfig: unknown): boolean => {
    const result = isMaybeRemoteConfig(jsonConfig)
      ? MCPRemoteConfigZodSchema.safeParse(jsonConfig)
      : MCPStdioConfigZodSchema.safeParse(jsonConfig);
    if (!result.success) {
      handleErrorWithToast(result.error, "mcp-editor-error");
    }
    return result.success;
  };

  // Handle save button click
  const handleSave = async () => {
    // Perform validation
    if (!validateConfig(config)) return;
    if (!name) {
      return handleErrorWithToast(
        new Error(t("MCP.nameIsRequired")),
        "mcp-editor-error",
      );
    }

    if (!validateName(name)) {
      return handleErrorWithToast(
        new Error(t("MCP.nameMustContainOnlyAlphanumericCharactersAndHyphens")),
        "mcp-editor-error",
      );
    }

    safe(() => setIsLoading(true))
      .map(async () => {
        // Note: Backend validation in /api/mcp/route.ts already checks
        // for duplicate names per user, so we don't need to check here
        // The global check was preventing different users from using the same name
      })
      .map(() =>
        fetcher("/api/mcp", {
          method: shouldInsert ? "POST" : "PUT",
          body: JSON.stringify({
            name,
            config,
            ...(shouldInsert ? {} : { id }),
            visibility,
          }),
        }),
      )
      .ifOk((result) => {
        // Track MCP server creation (only for new servers)
        if (shouldInsert) {
          analytics.mcpServerCreated({
            serverId: result?.id || id || name,
            serverName: name,
            serverType: isMaybeRemoteConfig(config) ? "remote" : "stdio",
          });
        }

        mutate("/api/mcp/list");
        router.push("/mcp");
      })
      .ifFail(handleErrorWithToast)
      .watch(() => setIsLoading(false));
  };

  const handleConfigChange = (data: string) => {
    setJsonString(data);
    const result = safeJSONParse(data);
    errorDebounce.clear();
    if (result.success) {
      setConfig(result.value as MCPServerConfig);
      setJsonError(null);
    } else if (data.trim() !== "") {
      errorDebounce(() => {
        setJsonError(
          (result.error as Error)?.message ??
            JSON.stringify(result.error, null, 2),
        );
      }, 1000);
    }
  };

  return (
    <>
      <div className="flex flex-col space-y-6">
        {/* Name field */}
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>

          <Input
            id="name"
            value={name}
            disabled={!shouldInsert}
            onChange={(e) => {
              setName(e.target.value);
              if (e.target.value) validateName(e.target.value);
            }}
            placeholder={t("MCP.enterMcpServerName")}
            className={nameError ? "border-destructive" : ""}
          />
          {nameError && <p className="text-xs text-destructive">{nameError}</p>}
        </div>

        {/* Visibility field */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="visibility">{t("Agent.visibility")}</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoIcon className="size-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <div className="space-y-2">
                  <p className="font-medium">
                    {t("MCP.visibility.private")}:{" "}
                    {t("MCP.visibility.privateDescription")}
                  </p>
                  <p className="font-medium">
                    {t("MCP.visibility.readonly")}:{" "}
                    {t("MCP.visibility.readonlyDescription")}
                  </p>
                  <p className="font-medium">
                    {t("MCP.visibility.public")}:{" "}
                    {t("MCP.visibility.publicDescription")}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
          <Select
            value={visibility}
            onValueChange={(value: Visibility) => setVisibility(value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">
                    {t("MCP.visibility.private")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("MCP.visibility.privateDescription")}
                  </span>
                </div>
              </SelectItem>
              <SelectItem value="readonly">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">
                    {t("MCP.visibility.readonly")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("MCP.visibility.readonlyDescription")}
                  </span>
                </div>
              </SelectItem>
              <SelectItem value="public">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">
                    {t("MCP.visibility.public")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("MCP.visibility.publicDescription")}
                  </span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="config">
              {simpleMode ? t("MCP.serverUrl") : "Config"}
            </Label>
            <div className="flex items-center gap-2">
              <Label
                htmlFor="developer-mode"
                className="text-xs text-muted-foreground cursor-pointer"
              >
                {t("MCP.advancedMode")}
              </Label>
              <Switch
                id="developer-mode"
                checked={!simpleMode}
                onCheckedChange={(checked) => setSimpleMode(!checked)}
              />
            </div>
          </div>

          {simpleMode ? (
            // Simple mode: Just URL input
            <div className="space-y-2">
              <Input
                id="url-input"
                type="url"
                value={urlInput}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="https://server.smithery.ai/@username/server-name/mcp"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                {t("MCP.pasteSmitheryUrl")}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 mt-4">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="flex items-center justify-center"
                    >
                      <HelpCircle className="size-4 mr-2" />
                      {t("MCP.howToGetThis")}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-md">
                    <div className="space-y-2">
                      <p className="font-medium">
                        {t("MCP.howToGetThisDescription")}
                      </p>
                      <ol className="list-decimal list-inside space-y-1 text-sm">
                        <li>{t("MCP.step1")}</li>
                        <li>{t("MCP.step2")}</li>
                        <li>{t("MCP.step3")}</li>
                      </ol>
                    </div>
                  </TooltipContent>
                </Tooltip>
                <a
                  href="https://smithery.ai/servers"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 sm:flex-none"
                >
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto flex items-center justify-center"
                  >
                    <ExternalLink className="size-4 mr-2" />
                    {t("MCP.setupInSmithery")}
                  </Button>
                </a>
              </div>
            </div>
          ) : (
            // Advanced mode: JSON editor
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Left side: Textarea for editing */}
              <div className="space-y-2">
                <Textarea
                  id="config-editor"
                  value={jsonString}
                  onChange={(e) => handleConfigChange(e.target.value)}
                  data-testid="mcp-config-editor"
                  className="font-mono h-[40vh] resize-none overflow-y-auto"
                  placeholder={STDIO_ARGS_ENV_PLACEHOLDER}
                />
              </div>

              {/* Right side: JSON view */}
              <div className="space-y-2 hidden sm:block">
                <div className="border border-input rounded-md p-4 h-[40vh] overflow-auto relative bg-secondary">
                  <Label
                    htmlFor="config-view"
                    className="text-xs text-muted-foreground mb-2"
                  >
                    preview
                  </Label>
                  <JsonView
                    data={config}
                    initialExpandDepth={3}
                    data-testid="mcp-config-view"
                  />
                  {jsonError && jsonString && (
                    <div className="absolute w-full bottom-0 right-0 px-2 pb-2 animate-in fade-in-0 duration-300">
                      <Alert
                        variant="destructive"
                        className="border-destructive"
                      >
                        <AlertTitle className="text-xs font-semibold">
                          Parsing Error
                        </AlertTitle>
                        <AlertDescription className="text-xs">
                          {jsonError}
                        </AlertDescription>
                      </Alert>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Save button */}
        <Button onClick={handleSave} className="w-full" disabled={saveDisabled}>
          {isLoading ? (
            <Loader className="size-4 animate-spin" />
          ) : (
            <span className="font-bold">{t("MCP.saveConfiguration")}</span>
          )}
        </Button>
      </div>
    </>
  );
}

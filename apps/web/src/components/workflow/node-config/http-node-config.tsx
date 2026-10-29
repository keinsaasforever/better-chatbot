"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, Plus, TriangleAlertIcon, VariableIcon } from "lucide-react";
import {
  HttpNodeData,
  HttpMethod,
  OutputSchemaSourceKey,
} from "lib/ai/workflow/workflow.interface";
import { UINode } from "lib/ai/workflow/workflow.interface";
import { HttpValueInput } from "../http-value-input";
import { useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { capitalizeFirstLetter, cn } from "lib/utils";
import { Textarea } from "ui/textarea";
import { VariableSelect } from "../variable-select";
import { VariableMentionItem } from "../variable-mention-item";
import { findAvailableSchemaBySource } from "lib/ai/workflow/shared.workflow";

const HTTP_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
];

const tabs = ["basic", "headers", "query", "body"] as const;

const headerExample = [
  {
    key: "Content-Type",
    value: "application/json",
  },
  {
    key: "Authorization",
    value: "Bearer <token>",
  },
  {
    key: "X-API-Key",
    value: "1234567890",
  },
];

const queryExample = [
  {
    key: "page",
    value: "1",
  },
  {
    key: "limit",
    value: "10",
  },
  {
    key: "sort",
    value: "created_at",
  },
];
export function HttpNodeConfig({ node }: { node: UINode<any> }) {
  const httpNode = node.data as HttpNodeData;
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("basic");

  const { updateNodeData, getNodes, getEdges } = useReactFlow<UINode>();

  const handleUpdateNode = (updates: Partial<HttpNodeData>) => {
    updateNodeData(node.id, updates);
  };

  const addHeader = () => {
    const currentHeaders = httpNode.headers || [];
    handleUpdateNode({
      headers: [...currentHeaders, { key: "", value: undefined }],
    });
  };

  const updateHeader = (index: number, key: string, value?: any) => {
    const currentHeaders = httpNode.headers || [];
    const newHeaders = [...currentHeaders];
    newHeaders[index] = { key, value };
    handleUpdateNode({ headers: newHeaders });
  };

  const removeHeader = (index: number) => {
    const currentHeaders = httpNode.headers || [];
    const newHeaders = currentHeaders.filter((_, i) => i !== index);
    handleUpdateNode({ headers: newHeaders });
  };

  const addQueryParam = () => {
    const currentQuery = httpNode.query || [];
    handleUpdateNode({
      query: [...currentQuery, { key: "", value: undefined }],
    });
  };

  const updateQueryParam = (index: number, key: string, value?: any) => {
    const currentQuery = httpNode.query || [];
    const newQuery = [...currentQuery];
    newQuery[index] = { key, value };
    handleUpdateNode({ query: newQuery });
  };

  const removeQueryParam = (index: number) => {
    const currentQuery = httpNode.query || [];
    const newQuery = currentQuery.filter((_, i) => i !== index);
    handleUpdateNode({ query: newQuery });
  };

  const isBodyVariable =
    httpNode.body &&
    typeof httpNode.body === "object" &&
    "nodeId" in httpNode.body;

  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="flex relative">
        <div className="absolute inset-0 w-full border-b pointer-events-none" />
        {tabs.map((tab) => (
          <Button
            key={tab}
            variant="ghost"
            className={cn(
              "rounded-none border-b",
              tab === activeTab && "border-primary",
            )}
            onClick={() => setActiveTab(tab)}
          >
            {capitalizeFirstLetter(tab)}
          </Button>
        ))}
      </div>

      <Card className="border-none">
        <CardHeader className="sr-only">
          <CardTitle>
            {activeTab === "basic"
              ? "HTTP Request Configuration"
              : activeTab === "headers"
                ? "Request Headers"
                : activeTab === "query"
                  ? "Query Parameters"
                  : "Request Body"}
          </CardTitle>
        </CardHeader>

        {activeTab === "basic" && (
          <CardContent className="space-y-4">
            {/* HTTP Method */}
            <div className="space-y-2">
              <Label htmlFor="method">Method</Label>
              <Select
                value={httpNode.method}
                onValueChange={(value) =>
                  handleUpdateNode({
                    method: value as HttpMethod,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select HTTP method" />
                </SelectTrigger>
                <SelectContent>
                  {HTTP_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* URL */}
            <div className="space-y-2">
              <Label htmlFor="url">URL</Label>
              <HttpValueInput
                allowedTypes={["string"]}
                currentNodeId={httpNode.id}
                value={httpNode.url}
                onChange={(value) => handleUpdateNode({ url: value })}
                placeholder="https://api.example.com/endpoint"
              />
            </div>

            {/* Timeout */}
            <div className="space-y-2">
              <Label htmlFor="timeout">Timeout (ms)</Label>
              <Input
                id="timeout"
                type="number"
                value={httpNode.timeout || 30000}
                onChange={(e) =>
                  handleUpdateNode({
                    timeout: parseInt(e.target.value) || 30000,
                  })
                }
                min={1000}
                max={300000}
                step={1000}
              />
              <p className="text-xs text-gray-500">
                Request timeout in milliseconds (1s - 5min)
              </p>
            </div>
          </CardContent>
        )}

        {/* Headers Configuration */}
        {activeTab === "headers" && (
          <CardContent className="space-y-4">
            {(httpNode.headers || []).map((header, index) => (
              <div key={index} className="flex gap-2 items-end">
                <div>
                  <Label className="text-xs mb-1 ml-1">Key</Label>
                  <Input
                    value={header.key}
                    className="w-24 placeholder:text-xs"
                    onChange={(e) =>
                      updateHeader(index, e.target.value, header.value)
                    }
                    placeholder={headerExample[index]?.key}
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs mb-1 ml-1">Value</Label>
                  <HttpValueInput
                    allowedTypes={["string", "number"]}
                    className="max-w-[230px]"
                    currentNodeId={httpNode.id}
                    value={header.value}
                    onChange={(value) => updateHeader(index, header.key, value)}
                    placeholder={headerExample[index]?.value}
                    onDelete={() => removeHeader(index)}
                  />
                </div>
              </div>
            ))}
            <Button onClick={addHeader} variant="outline" className="w-full">
              <Plus className="size-3.5" />
              Add Header
            </Button>
          </CardContent>
        )}

        {/* Query Parameters Configuration */}
        {activeTab === "query" && (
          <CardContent className="space-y-4">
            {(httpNode.query || []).map((param, index) => (
              <div key={index} className="flex gap-2 items-end">
                <div>
                  <Label className="text-xs mb-1 ml-1 text-muted-foreground">
                    Key
                  </Label>
                  <Input
                    className="w-24 placeholder:text-xs"
                    value={param.key}
                    onChange={(e) =>
                      updateQueryParam(index, e.target.value, param.value)
                    }
                    placeholder={queryExample[index]?.key}
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs mb-1 ml-1 text-muted-foreground">
                    Value
                  </Label>
                  <HttpValueInput
                    allowedTypes={["string", "number"]}
                    currentNodeId={httpNode.id}
                    value={param.value}
                    onChange={(value) =>
                      updateQueryParam(index, param.key, value)
                    }
                    placeholder={queryExample[index]?.value}
                    onDelete={() => removeQueryParam(index)}
                  />
                </div>
              </div>
            ))}
            <Button
              onClick={addQueryParam}
              variant="outline"
              className="w-full"
            >
              <Plus className="size-3.5" />
              Add Query Parameter
            </Button>
          </CardContent>
        )}

        {/* Body Configuration */}
        {activeTab === "body" && (
          <CardContent className="space-y-4">
            {["POST", "PUT", "PATCH"].includes(httpNode.method) ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label>Body</Label>
                  <VariableSelect
                    currentNodeId={httpNode.id}
                    onChange={(value) => handleUpdateNode({ body: value })}
                  >
                    <Button
                      variant={isBodyVariable ? "secondary" : "ghost"}
                      className="ml-auto data-[state=open]:bg-secondary"
                      size="sm"
                    >
                      <VariableIcon className="size-3" />
                    </Button>
                  </VariableSelect>
                </div>
                {!isBodyVariable ? (
                  <Textarea
                    className="resize-none h-48"
                    placeholder={`{
  "name": "example",
  "value": 123
}`}
                    value={httpNode.body?.toString() || ""}
                    onChange={(e) => handleUpdateNode({ body: e.target.value })}
                  />
                ) : (
                  <VariableMentionItem
                    className="py-[7px] text-sm truncate"
                    {...findAvailableSchemaBySource({
                      nodeId: httpNode.id,
                      source: httpNode.body as OutputSchemaSourceKey,
                      nodes: getNodes().map((node) => node.data),
                      edges: getEdges(),
                    })}
                    onRemove={() => handleUpdateNode({ body: undefined })}
                  />
                )}
                <p className="text-xs text-muted-foreground px-4 mt-4">
                  Request body content. JSON format will be auto-detected and
                  Content-Type header will be set automatically if not
                  specified.
                </p>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>
                  Request body is not available for {httpNode.method} requests.
                </p>
                <p className="text-xs mt-1">
                  Only POST, PUT, and PATCH requests can have a body.
                </p>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

export function HttpNodeDataStack({ data }: { data: HttpNodeData }) {
  const { getNodes } = useReactFlow();

  const urlDisplay = (() => {
    if (!data.url) return "No URL";

    if (typeof data.url === "string") {
      const isUrl = data.url.startsWith("http");
      return (
        <div className="w-48 gap-1 flex items-center px-2 py-1 rounded-sm bg-background">
          {isUrl ? (
            <Link className="size-3 text-blue-500" />
          ) : (
            <TriangleAlertIcon className="size-3 text-destructive" />
          )}

          <span className="text-foreground truncate flex-1">{data.url}</span>
        </div>
      );
    }

    if (typeof data.url === "object" && "nodeId" in data.url) {
      const nodes = getNodes() as UINode[];
      const urlAsSource = data.url as OutputSchemaSourceKey;
      const sourceNode = nodes.find(
        (node) => node.data.id === urlAsSource.nodeId,
      );

      return (
        <VariableMentionItem
          nodeName={sourceNode?.data.name || "ERROR"}
          path={urlAsSource.path}
          notFound={!sourceNode}
          className="text-[10px] ring-0 w-full"
        />
      );
    }

    return "Unknown source";
  })();

  return (
    <div className="flex flex-col gap-1 px-4 mt-4">
      <div className="text-[10px] px-2 py-1 flex items-center gap-2s">
        <span className="px-1.5 py-0.5 rounded-lg font-semibold text-muted-foreground">
          {data.method}
        </span>
        <div className="truncate flex-1 font-bold text-muted-foreground flex items-center">
          {urlDisplay}
        </div>
      </div>
    </div>
  );
}

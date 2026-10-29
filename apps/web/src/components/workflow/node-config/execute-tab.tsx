import { useWorkflowStore } from "@/app/store/workflow.store";
import {
  NodeKind,
  NodeRuntimeHistory,
} from "lib/ai/workflow/workflow.interface";
import { useReactFlow } from "@xyflow/react";
import { useObjectState } from "@/hooks/use-object-state";
import { UINode } from "lib/ai/workflow/workflow.interface";
import { cn, createDebounce, errorToString } from "lib/utils";
import { useCallback, useMemo, useRef, useState } from "react";
import { GraphEndEvent } from "ts-edge";
import { allNodeValidate } from "lib/ai/workflow/node-validate";
import { toast } from "sonner";
import { decodeWorkflowEvents } from "lib/ai/workflow/shared.workflow";
import { Alert, AlertDescription, AlertTitle } from "ui/alert";
import {
  AlertTriangleIcon,
  Loader,
  Loader2,
  Copy,
  Check,
  WandSparklesIcon,
  XIcon,
  Maximize2,
} from "lucide-react";
import JsonView from "ui/json-view";
import { Button } from "ui/button";
import { Separator } from "ui/separator";
import { FlipWords } from "ui/flip-words";
import { Label } from "ui/label";
import { Input } from "ui/input";
import { Switch } from "ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";
import { Textarea } from "ui/textarea";
import { NodeIcon } from "../node-icon";
import { TextShimmer } from "ui/text-shimmer";
import { generateObjectAction } from "@/app/api/chat/actions";
import { appStore } from "@/app/store";
import { notify } from "lib/notify";
import { SelectModel } from "@/components/select-model";

import { useCopy } from "@/hooks/use-copy";
import { NodeResultPopup } from "../node-result-popup";
import { useTranslations } from "next-intl";

export function ExecuteTab({
  close,
  onSave,
}: {
  close: () => void;
  onSave: () => Promise<void>;
}) {
  const { addProcess, processIds, workflow } = useWorkflowStore();
  const debounce = useMemo(() => createDebounce(), []);

  const tabs = useMemo(
    () => [
      {
        label: "Input",
        value: "input",
      },
      {
        label: "Result",
        value: "result",
      },
    ],
    [],
  );

  const [tab, setTab] = useState<(typeof tabs)[number]["value"]>(tabs[0].value);
  const t = useTranslations();
  const [isRunning, setIsRunning] = useState(false);
  const [histories, setHistories] = useState<NodeRuntimeHistory[]>([]);
  const [result, setResult] = useState<GraphEndEvent | undefined>();
  const { copied, copy } = useCopy();

  const isProcessing = useMemo(
    () => Boolean(processIds.length),
    [processIds.length],
  );

  const { getEdges, getNodes, fitView, getNode, updateNodeData, setNodes } =
    useReactFlow<UINode>();
  const nodes = getNodes();
  const historyRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useObjectState({} as Record<string, any>);

  const startNodeData = useMemo(() => {
    return nodes.find((node) => node.data.kind === NodeKind.Input)!.data;
  }, [nodes]);

  const inputSchema = useMemo(() => {
    return startNodeData.outputSchema;
  }, [startNodeData]);

  const inputSchemaIterator = useMemo(() => {
    return Object.entries(inputSchema.properties ?? {});
  }, [inputSchema]);

  const handleGenerateInputWithAI = useCallback(async () => {
    let model = appStore.getState().chatModel;
    const result = await notify.prompt({
      title: t("Common.generateInputWithAI"),
      description: (
        <div className="flex items-center gap-2">
          <p className="mr-auto">
            {t("Workflow.generateInputWithAIDescription")}
          </p>
          <SelectModel
            onSelect={(m) => {
              model = m;
            }}
          />
        </div>
      ),
    });
    if (!result) return;
    toast.promise(
      generateObjectAction({
        model,
        prompt: {
          system: `You are a parameter generator for tool execution.
Analyze the user's request and generate creative JSON data that matches the provided schema.
If information cannot be inferred from the user's question, use your creativity to generate engaging data.
Fill all required fields and return only valid JSON without explanations.

tool-name: ${workflow!.name}
${workflow!.description ? `tool-description: ${workflow!.description}` : ""}`,
          user: result,
        },
        schema: inputSchema,
      }).then((res) => {
        setQuery(res);
      }),
      {
        loading: t("Common.generatingInputWithAI"),
        success: t("Common.inputGeneratedSuccessfully"),
        error: t("Common.failedToGenerateInput"),
      },
    );
  }, [inputSchema]);

  const handleClick = async () => {
    await onSave();
    const failSchema = inputSchemaIterator.find(([key]) => {
      if (inputSchema.required?.includes(key) && query[key] === undefined)
        return true;
    });
    if (failSchema) {
      return toast.warning(`${failSchema[0]} is Empty`);
    }

    const validateResult = allNodeValidate({
      nodes,
      edges: getEdges(),
    });

    if (validateResult !== true) {
      if (validateResult.node) {
        setNodes((nds) => {
          return nds.map((node) => {
            if (node.id === validateResult.node?.id) {
              return { ...node, selected: true };
            }
            if (node.selected) {
              return { ...node, selected: false };
            }
            return node;
          });
        });
      }
      return toast.warning(validateResult.errorMessage);
    }
    run(query);
  };

  const fitviewWithDebounce = useCallback((id: string) => {
    const node = getNode(id);
    if (!node) return;
    const nextNodes = getEdges()
      .filter((edge) => edge.source == id)
      .map((edge) => getNode(edge.target))
      .filter(Boolean) as UINode[];
    const fitviewNodes = [node, ...nextNodes];
    debounce(() => {
      fitView({
        duration: 300,
        nodes: fitviewNodes,
        maxZoom: 1.8,
      });
    }, 300);
  }, []);

  const run = useCallback(
    async (query: Record<string, any>) => {
      const stop = addProcess();
      const abortController = new AbortController();
      setHistories([]);
      setIsRunning(true);
      setNodes((nds) => {
        return nds.map((node) => {
          if (node.data.runtime?.status) {
            return {
              ...node,
              data: { ...node.data, runtime: { status: undefined } },
            };
          }
          return node;
        });
      });
      try {
        const response = await fetch(`/api/workflow/${workflow!.id}/execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No readable stream available");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const { events, remainingBuffer } = decodeWorkflowEvents(buffer);
            buffer = remainingBuffer;

            for (const event of events) {
              switch (event.eventType) {
                case "WORKFLOW_START":
                  setTab("result");
                  break;
                case "WORKFLOW_END":
                  setResult(event);
                  stop();
                  break;
                case "NODE_START": {
                  fitviewWithDebounce(event.node.name);
                  historyRef.current?.scrollTo({
                    top: historyRef.current?.scrollHeight,
                    behavior: "smooth",
                  });
                  updateNodeData(event.node.name, {
                    runtime: { status: "running" },
                  });
                  setHistories((prev) => {
                    const uiNode = getNode(event.node.name);
                    if (!uiNode) return prev;
                    return [
                      ...prev,
                      {
                        nodeId: event.node.name,
                        startedAt: Date.now(),
                        id: event.nodeExecutionId,
                        name: uiNode.data.name,
                        kind: uiNode.data.kind,
                        status: "running",
                      },
                    ];
                  });
                  break;
                }
                case "NODE_END": {
                  updateNodeData(event.node.name, {
                    runtime: { status: event.isOk ? "success" : "fail" },
                  });
                  setHistories((prev) => {
                    const prevHistory = prev.find(
                      (h) => h.id === event.nodeExecutionId,
                    );
                    if (!prevHistory) return prev;
                    return prev.map((n) => {
                      if (n != prevHistory) return n;
                      const source = event.isOk
                        ? event.node.output
                        : event.node.input;
                      return {
                        ...prevHistory,
                        endedAt: Date.now(),
                        status: event.isOk ? "success" : "fail",
                        error: event.error,
                        result: {
                          output: source?.outputs?.[prevHistory.nodeId],
                          input: source?.inputs?.[prevHistory.nodeId],
                        },
                      } as NodeRuntimeHistory;
                    });
                  });
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
          stop();
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          console.log("Workflow execution was aborted");
        } else {
          console.error("Workflow execution error:", error);
        }
        stop();
      } finally {
        setIsRunning(false);
      }
    },
    [workflow!.id],
  );

  const lastOutput = useMemo(() => {
    const outputNodes = histories
      .filter((h) => h.kind == NodeKind.Output)
      .map((h) => h.result?.output)
      .filter(Boolean);

    if (outputNodes.length == 0) return undefined;
    if (outputNodes.length == 1) return outputNodes[0];
    return outputNodes;
  }, [histories]);

  const resultView = useMemo(() => {
    if (isRunning) return;
    if (result?.isOk === false)
      return (
        <Alert variant={"destructive"} className="border-destructive">
          <AlertTriangleIcon />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            <JsonView data={result?.error} />
          </AlertDescription>
        </Alert>
      );
    return (
      <div className="p-2">
        <JsonView data={lastOutput} />
      </div>
    );
  }, [isRunning, result]);
  return (
    <div className="fade-300 w-sm h-[85vh] bg-card border rounded-lg shadow-lg overflow-y-auto py-4">
      <div className="flex flex-col px-4">
        <div className="flex items-center gap-2 w-full h-9">
          <span className="font-semibold">Test Run</span>
          <div
            className={cn(
              "p-1 rounded hover:bg-secondary cursor-pointer ml-auto",
              isProcessing && "sr-only",
            )}
            onClick={close}
          >
            <XIcon className="size-3.5" />
          </div>
        </div>
      </div>
      <div className="flex">
        {tabs.map((t) => (
          <Button
            key={t.value}
            variant="ghost"
            className={cn(
              "rounded-none",
              tab == t.value && "border-b border-primary",
            )}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </Button>
        ))}
      </div>
      <Separator className="mb-4" />

      {tab == tabs[0].value ? (
        <div className="px-4 flex flex-col gap-4">
          {inputSchemaIterator.length == 0 ? (
            <div className="flex items-center justify-center h-40">
              <FlipWords
                className="text-sm text-muted-foreground"
                words={["No input required for this workflow"]}
              />
            </div>
          ) : (
            <>
              <div
                tabIndex={1}
                onClick={handleGenerateInputWithAI}
                className="hover:bg-secondary rounded-sm px-2 py-1 flex items-center gap-2 ml-auto text-xs font-semibold cursor-pointer hover:text-primary transition-colors"
              >
                {t("Common.generateInputWithAI")}
                <WandSparklesIcon className="size-3" />
              </div>
              {inputSchemaIterator.map(([key, schema], i) => {
                return (
                  <div key={key ?? i}>
                    <Label
                      className="mb-2 text-sm font-semibold ml-0.5 gap-0.5"
                      htmlFor={key || String(i)}
                    >
                      {key || "undefined"}
                      {inputSchema.required?.includes(key) && (
                        <span className="text-xs text-destructive">*</span>
                      )}
                    </Label>
                    {schema.type == "number" ? (
                      <Input
                        disabled={isProcessing}
                        id={key || String(i)}
                        type="number"
                        placeholder={schema.description || "number"}
                        defaultValue={query[key] || undefined}
                        onChange={(e) =>
                          setQuery({ ...query, [key]: Number(e.target.value) })
                        }
                      />
                    ) : schema.type == "boolean" ? (
                      <Switch
                        disabled={isProcessing}
                        id={key || String(i)}
                        checked={query[key]}
                        onCheckedChange={(checked) =>
                          setQuery({ ...query, [key]: checked })
                        }
                      />
                    ) : schema.type == "string" && schema.enum ? (
                      <Select
                        disabled={isProcessing}
                        value={query[key]}
                        onValueChange={(value) =>
                          setQuery({ ...query, [key]: value })
                        }
                      >
                        <SelectTrigger
                          id={key || String(i)}
                          className="min-w-46"
                        >
                          <SelectValue
                            placeholder={schema.description || "option"}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {(schema.enum as string[]).map((item, i) => (
                            <SelectItem key={item ?? i} value={item}>
                              {item}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : schema.type == "string" ? (
                      <Textarea
                        disabled={isProcessing}
                        id={key || String(i)}
                        value={query[key]}
                        className="resize-none max-h-28 overflow-y-auto"
                        placeholder={schema.description || "string"}
                        onChange={(e) =>
                          setQuery({ ...query, [key]: e.target.value })
                        }
                      />
                    ) : null}
                  </div>
                );
              })}
            </>
          )}
          <Button
            disabled={isProcessing}
            className="font-bold w-full"
            onClick={handleClick}
          >
            {isProcessing ? (
              <Loader className="size-3.5 animate-spin" />
            ) : (
              t("Common.run")
            )}
          </Button>
        </div>
      ) : tab == tabs[1].value ? (
        <div>
          <div
            className="flex flex-col px-4 h-[30vh] overflow-y-auto"
            ref={historyRef}
          >
            {histories.map((history, i) => {
              return (
                <NodeResultPopup history={history} key={i}>
                  <div
                    className={cn(
                      "cursor-pointer hover:bg-secondary flex items-center gap-2 text-sm rounded-sm px-2 py-1.5 relative",
                      history.status == "fail" && "text-destructive",
                    )}
                  >
                    {i != 0 && (
                      <div className="absolute left-4.5 -top-1.5 w-px h-3">
                        <Separator orientation="vertical" />
                      </div>
                    )}
                    <div className="border rounded overflow-hidden">
                      <NodeIcon
                        type={history.kind}
                        iconClassName="size-3"
                        className="rounded-none"
                      />
                    </div>
                    {history.status == "running" ? (
                      <TextShimmer className="font-semibold">
                        {`${history.name} Running...`}
                      </TextShimmer>
                    ) : (
                      <span className="font-semibold">{history.name}</span>
                    )}
                    <span
                      className={cn(
                        "ml-auto text-xs",
                        history.status != "fail" && "text-muted-foreground",
                      )}
                    >
                      {history.status != "running" &&
                        (
                          (history.endedAt! - history.startedAt!) /
                          1000
                        ).toFixed(2)}
                    </span>
                    {history.status == "success" ? (
                      <Check className="size-3" />
                    ) : history.status == "fail" ? (
                      <XIcon className="size-3" />
                    ) : (
                      <Loader2 className="size-3 animate-spin" />
                    )}
                  </div>
                </NodeResultPopup>
              );
            })}
          </div>
          <Separator />
          <div className="px-4 py-4">
            <div className="flex items-center mb-4">
              <p className="font-semibold text-sm">Result</p>
              <div className="flex-1" />
              {result && (
                <NodeResultPopup
                  history={{
                    name: "Result",
                    status: result.isOk ? "success" : "fail",
                    startedAt: result.startedAt,
                    endedAt: result.endedAt,
                    error: errorToString(result.error),
                    result: {
                      input: histories[0].result?.output ?? {},
                      output: histories.at(-1)?.result?.output ?? {},
                    },
                  }}
                >
                  <Button variant={"ghost"} size={"icon"}>
                    <Maximize2 className="size-3" />
                  </Button>
                </NodeResultPopup>
              )}
              <Button
                variant={"ghost"}
                size={"icon"}
                className="ml-auto"
                onClick={() => copy(JSON.stringify(lastOutput))}
              >
                {copied ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
              </Button>
            </div>
            {resultView}
          </div>
        </div>
      ) : null}
    </div>
  );
}

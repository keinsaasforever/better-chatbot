"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Check,
  Search,
  ExternalLink,
  AlertCircle,
  Eye,
  EyeOff,
  Key,
  ServerOff,
} from "lucide-react";
import { toast } from "sonner";
import { useLocalModelsCheckout } from "@/components/gate";
import { mutate as swrMutate } from "swr";
import { useLocalModelsConfig } from "@/hooks/use-local-models-config";

interface LocalModelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasAccess: boolean;
}

export function LocalModelsDialog({
  open,
  onOpenChange,
  hasAccess: initialHasAccess,
}: LocalModelsDialogProps) {
  const router = useRouter();
  const { canSubscribe, subscribe } = useLocalModelsCheckout();
  const { config: existingConfig, mutate: mutateConfig } =
    useLocalModelsConfig();

  const [hasAccess, setHasAccess] = useState(initialHasAccess);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  // ── Ollama / LM Studio state ──────────────────────────────────────────────
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434");
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<any[]>([]);
  const [detectedType, setDetectedType] = useState<"ollama" | "lmstudio">();
  const [isSaving, setIsSaving] = useState(false);

  // ── Xinity / OpenAI-compatible state ─────────────────────────────────────
  const [xinityUrl, setXinityUrl] = useState("");
  const [xinityApiKey, setXinityApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [isXinityDiscovering, setIsXinityDiscovering] = useState(false);
  const [xinityDiscoveredModels, setXinityDiscoveredModels] = useState<any[]>(
    [],
  );
  const [isXinitySaving, setIsXinitySaving] = useState(false);
  const [xinityDiscoveryError, setXinityDiscoveryError] = useState<
    string | null
  >(null);

  const hasAutoDiscoveredRef = useRef(false);

  // Populate forms when dialog opens with existing config
  useEffect(() => {
    if (open && existingConfig?.baseUrl) {
      if (existingConfig.type === "openai_compatible") {
        setXinityUrl(existingConfig.baseUrl);
        setXinityDiscoveredModels(existingConfig.models || []);
        setDiscoveredModels([]);
      } else {
        setBaseUrl(existingConfig.baseUrl);
        setDetectedType(existingConfig.type as "ollama" | "lmstudio");
        setDiscoveredModels(existingConfig.models || []);
        setXinityDiscoveredModels([]);
      }
    } else if (open) {
      setBaseUrl("http://localhost:11434");
      setDiscoveredModels([]);
      setDetectedType(undefined);
      setXinityUrl("");
      setXinityDiscoveredModels([]);
    }
  }, [open, existingConfig]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setDiscoveredModels([]);
      setDetectedType(undefined);
      setXinityDiscoveredModels([]);
      setXinityDiscoveryError(null);
      setShowApiKey(false);
      hasAutoDiscoveredRef.current = false;
    }
  }, [open]);

  const handleSubscribe = async () => {
    try {
      setIsCheckingOut(true);
      await subscribe();
      router.refresh();
      setHasAccess(true);
    } catch (_error) {
      toast.error("Failed to start checkout");
    } finally {
      setIsCheckingOut(false);
    }
  };

  // ── Ollama / LM Studio handlers ───────────────────────────────────────────
  const handleDiscover = async () => {
    try {
      setIsDiscovering(true);
      setDiscoveredModels([]);
      setDetectedType(undefined);

      const response = await fetch("/api/user/local-models/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl }),
      });

      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(error);
      }

      const { type, models } = await response.json();
      setDetectedType(type);
      setDiscoveredModels(models);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to discover models",
      );
    } finally {
      setIsDiscovering(false);
    }
  };

  // Auto-discover when dialog opens with existing ollama/lmstudio config
  useEffect(() => {
    if (
      open &&
      hasAccess &&
      existingConfig?.baseUrl &&
      existingConfig.type !== "openai_compatible" &&
      baseUrl === existingConfig.baseUrl &&
      !hasAutoDiscoveredRef.current
    ) {
      hasAutoDiscoveredRef.current = true;
      handleDiscover();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasAccess, existingConfig?.baseUrl, baseUrl]);

  const handleSave = async () => {
    try {
      setIsSaving(true);

      if (existingConfig && existingConfig.baseUrl !== baseUrl) {
        const deleteResponse = await fetch("/api/user/local-models/config", {
          method: "DELETE",
        });
        if (!deleteResponse.ok) {
          throw new Error("Failed to delete old configuration");
        }
      }

      const response = await fetch("/api/user/local-models/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          type: detectedType,
          models: discoveredModels,
        }),
      });

      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(error);
      }

      mutateConfig();
      swrMutate("/api/chat/models");
      router.refresh();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save configuration",
      );
    } finally {
      setIsSaving(false);
    }
  };

  // ── Xinity / OpenAI-compatible handlers ───────────────────────────────────
  const handleXinityDiscover = async () => {
    if (!xinityApiKey.trim()) {
      toast.error("Please enter an API key first");
      return;
    }
    try {
      setIsXinityDiscovering(true);
      setXinityDiscoveredModels([]);
      setXinityDiscoveryError(null);

      const response = await fetch("/api/user/local-models/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: xinityUrl,
          type: "openai_compatible",
          apiKey: xinityApiKey,
        }),
      });

      const json = await response.json();

      if (!response.ok) {
        setXinityDiscoveryError(json?.error ?? "Failed to discover models");
        return;
      }

      const { models } = json;
      setXinityDiscoveredModels(models);
    } catch (_error) {
      setXinityDiscoveryError("fetch failed");
    } finally {
      setIsXinityDiscovering(false);
    }
  };

  const handleXinitySave = async () => {
    if (!xinityApiKey.trim()) {
      toast.error("API key is required");
      return;
    }
    try {
      setIsXinitySaving(true);

      if (existingConfig) {
        await fetch("/api/user/local-models/config", { method: "DELETE" });
      }

      const response = await fetch("/api/user/local-models/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: xinityUrl,
          type: "openai_compatible",
          apiKey: xinityApiKey,
          models: xinityDiscoveredModels,
        }),
      });

      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(error);
      }

      mutateConfig();
      swrMutate("/api/chat/models");
      router.refresh();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save configuration",
      );
    } finally {
      setIsXinitySaving(false);
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return "";
    const gb = bytes / 1024 / 1024 / 1024;
    return `${gb.toFixed(1)} GB`;
  };

  // Detect whether the discovery error is a network/reachability problem
  const isXinityNetworkError =
    xinityDiscoveryError !== null &&
    (xinityDiscoveryError.toLowerCase().includes("fetch") ||
      xinityDiscoveryError.toLowerCase().includes("connect") ||
      xinityDiscoveryError.toLowerCase().includes("econnrefused") ||
      xinityDiscoveryError.toLowerCase().includes("network") ||
      xinityDiscoveryError.toLowerCase().includes("reach"));

  const isBusy =
    isDiscovering ||
    isSaving ||
    isXinityDiscovering ||
    isXinitySaving ||
    isCheckingOut;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        {!hasAccess && canSubscribe ? (
          /* ── Subscription upsell ── */
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>🚀 Local Models Pro</DialogTitle>
              <DialogDescription>
                Connect your local Ollama, LM Studio, or Xinity instance
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <h4 className="font-medium text-sm">What you get:</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {[
                  "Use your self-hosted Ollama or LM Studio models",
                  "Connect any OpenAI-compatible server (Xinity, vLLM, etc.)",
                  "No per-token charges — use your own hardware",
                  "100% private — data never leaves your infrastructure",
                  "Auto-detect all installed models",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-green-500 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-primary/10 p-4 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Monthly Subscription</span>
                <span className="text-2xl font-bold">€4.99</span>
              </div>
              <p className="text-xs text-muted-foreground">
                1 month free trial. Cancel anytime.
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isBusy}
              >
                Cancel
              </Button>
              <Button onClick={handleSubscribe} disabled={isBusy}>
                {isCheckingOut ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Start Free Trial — €4.99/month after"
                )}
              </Button>
            </div>
          </div>
        ) : (
          /* ── Configuration view — two columns ── */
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Connect Local Models</DialogTitle>
              <DialogDescription>
                Ollama or LM Studio on your machine via a tunnel, or a
                server-deployed Xinity gateway with a public URL.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* ── LEFT: Ollama / LM Studio ── */}
              <div className="space-y-4 border rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🦙</span>
                  <h3 className="font-semibold">Ollama / LM Studio</h3>
                  {detectedType && (
                    <Badge variant="secondary" className="ml-auto">
                      {detectedType === "ollama" ? "Ollama" : "LM Studio"}
                    </Badge>
                  )}
                </div>

                <div className="bg-muted p-3 rounded-md text-xs space-y-1">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                    <div>
                      Running locally? Expose it with a tunnel first.{" "}
                      <a
                        href="https://pinggy.io/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        Pinggy
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      {" · "}
                      <a
                        href="https://ollama.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        Ollama
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      {" · "}
                      <a
                        href="https://lmstudio.ai"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        LM Studio
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="baseUrl">Base URL</Label>
                  <Input
                    id="baseUrl"
                    type="url"
                    placeholder="https://abc.pinggy.io (tunnel URL)"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    disabled={isBusy}
                  />
                  <p className="text-xs text-muted-foreground">
                    Default ports: Ollama (11434) · LM Studio (1234)
                  </p>
                </div>

                <Button
                  onClick={handleDiscover}
                  disabled={isBusy || !baseUrl}
                  className="w-full"
                  variant="outline"
                >
                  {isDiscovering ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Detecting…
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      Discover Models
                    </>
                  )}
                </Button>

                {discoveredModels.length > 0 && (
                  <div className="space-y-2">
                    <Label>
                      Found {discoveredModels.length} model
                      {discoveredModels.length === 1 ? "" : "s"}
                    </Label>
                    <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
                      {discoveredModels.map((model) => (
                        <div
                          key={model.id}
                          className="flex items-center gap-2 text-sm py-0.5"
                        >
                          <Check className="h-3 w-3 text-green-500 shrink-0" />
                          <span className="font-mono flex-1 truncate text-xs">
                            {model.name}
                          </span>
                          {model.size && (
                            <span className="text-xs text-muted-foreground">
                              {formatBytes(model.size)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    <Button
                      onClick={handleSave}
                      disabled={isBusy}
                      className="w-full"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {existingConfig ? "Updating…" : "Connecting…"}
                        </>
                      ) : existingConfig &&
                        existingConfig.type !== "openai_compatible" ? (
                        "Update Configuration"
                      ) : (
                        `Connect ${discoveredModels.length} Model${discoveredModels.length === 1 ? "" : "s"}`
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {/* ── RIGHT: Xinity / OpenAI-compatible ── */}
              <div className="space-y-4 border rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔗</span>
                  <h3 className="font-semibold">Xinity / OpenAI-compatible</h3>
                  {existingConfig?.type === "openai_compatible" && (
                    <Badge variant="secondary" className="ml-auto">
                      Connected
                    </Badge>
                  )}
                </div>

                <div className="bg-muted p-3 rounded-md text-xs space-y-1">
                  <div className="flex items-start gap-2">
                    <Key className="h-3 w-3 mt-0.5 shrink-0" />
                    <div>
                      Deploy Xinity on a server with a public URL, then paste
                      the gateway URL here. Requires an API key.{" "}
                      <a
                        href="https://github.com/xinity-ai/xinity-ai"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        Xinity docs
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="xinityUrl">Gateway URL</Label>
                  <Input
                    id="xinityUrl"
                    type="url"
                    placeholder="https://ai.yourcompany.com"
                    value={xinityUrl}
                    onChange={(e) => {
                      setXinityUrl(e.target.value);
                      setXinityDiscoveryError(null);
                    }}
                    disabled={isBusy}
                  />
                  <p className="text-xs text-muted-foreground">
                    Public server URL — without /v1 suffix
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="xinityApiKey">API Key</Label>
                  <div className="relative">
                    <Input
                      id="xinityApiKey"
                      type={showApiKey ? "text" : "password"}
                      placeholder={
                        existingConfig?.type === "openai_compatible" &&
                        existingConfig.hasApiKey
                          ? "••••••••  (leave blank to keep existing)"
                          : "sk_…"
                      }
                      value={xinityApiKey}
                      onChange={(e) => {
                        setXinityApiKey(e.target.value);
                        setXinityDiscoveryError(null);
                      }}
                      disabled={isBusy}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showApiKey ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Stored server-side only — never sent to the browser
                  </p>
                </div>

                <Button
                  onClick={handleXinityDiscover}
                  disabled={isBusy || !xinityUrl || !xinityApiKey.trim()}
                  className="w-full"
                  variant="outline"
                >
                  {isXinityDiscovering ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Connecting…
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      Discover Models
                    </>
                  )}
                </Button>

                {/* ── Discovery error notification ── */}
                {xinityDiscoveryError && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                    <div className="flex items-start gap-2 text-destructive">
                      <ServerOff className="h-4 w-4 mt-0.5 shrink-0" />
                      <p className="text-xs font-medium">
                        {isXinityNetworkError
                          ? "Server not reachable"
                          : "Connection failed"}
                      </p>
                    </div>
                    {isXinityNetworkError ? (
                      <div className="text-xs text-muted-foreground space-y-1.5">
                        <p>
                          Xinity must be deployed on a server with a{" "}
                          <strong>public URL</strong> — it cannot be reached
                          when running on <code>localhost</code> from a
                          cloud-hosted app.
                        </p>
                        <p>Deploy Xinity on a VPS or dedicated server first:</p>
                        <a
                          href="https://github.com/xinity-ai/xinity-ai/blob/main/deployment/cli/README.md"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                          Xinity deployment guide
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {xinityDiscoveryError}
                      </p>
                    )}
                  </div>
                )}

                {/* ── Discovered models ── */}
                {xinityDiscoveredModels.length > 0 && (
                  <div className="space-y-2">
                    <Label>
                      Found {xinityDiscoveredModels.length} model
                      {xinityDiscoveredModels.length === 1 ? "" : "s"}
                    </Label>
                    <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
                      {xinityDiscoveredModels.map((model) => (
                        <div
                          key={model.id}
                          className="flex items-center gap-2 text-sm py-0.5"
                        >
                          <Check className="h-3 w-3 text-green-500 shrink-0" />
                          <span className="font-mono flex-1 truncate text-xs">
                            {model.name}
                          </span>
                        </div>
                      ))}
                    </div>

                    <Button
                      onClick={handleXinitySave}
                      disabled={isBusy || !xinityApiKey.trim()}
                      className="w-full"
                    >
                      {isXinitySaving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Connecting…
                        </>
                      ) : (
                        `Connect ${xinityDiscoveredModels.length} Model${xinityDiscoveredModels.length === 1 ? "" : "s"}`
                      )}
                    </Button>
                  </div>
                )}

                {/* Already configured status */}
                {existingConfig?.type === "openai_compatible" &&
                  xinityDiscoveredModels.length === 0 &&
                  !xinityDiscoveryError && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
                      <Check className="h-3 w-3 text-green-500" />
                      {existingConfig.models.length} model
                      {existingConfig.models.length === 1 ? "" : "s"} currently
                      connected · enter key above to update
                    </div>
                  )}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isBusy}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

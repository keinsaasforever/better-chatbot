"use client";

import { useState, useCallback, useEffect } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Loader2, ArrowRight, Plug } from "lucide-react";
import { Button } from "ui/button";
import { cn } from "lib/utils";
import type { ComposioToolkit } from "@/hooks/queries/use-composio-connections";
import type { OnboardingStep } from "app-types/user";
import {
  AutomationOverviewStep,
  type OnboardingLanguage,
} from "./AutomationOverviewStep";

const ONBOARDING_PAGE_SIZE = 50;

const connectAppsCopy = {
  de: {
    connectedLabel: "Verbunden",
    connectLabel: "Verbinden",
    disconnectLabel: "Trennen",
    loadError: "Apps konnten nicht geladen werden",
    connectError: "App konnte nicht verbunden werden",
    disconnectError: "Verbindung konnte nicht getrennt werden",
    disconnectedToast: "Getrennt",
    heading: "Verbindet eure Apps",
    description:
      "Verbindet die Tools, die ihr jeden Tag nutzt. Eure KI kann sie danach automatisch einsetzen - ohne Copy-Paste und ohne Tab-Hopping.",
    connectedCount: (count: number) =>
      `${count} App${count !== 1 ? "s" : ""} verbunden`,
    loadingMore: "Lädt...",
    loadMore: "Mehr laden",
    skip: "Erstmal überspringen",
    primaryWithApps: "Navigator starten",
    primaryWithoutApps: "Zur App",
    continueError: "Weiter geht gerade nicht",
  },
  en: {
    connectedLabel: "Connected",
    connectLabel: "Connect",
    disconnectLabel: "Disconnect",
    loadError: "Failed to load apps",
    connectError: "Failed to connect app",
    disconnectError: "Failed to disconnect",
    disconnectedToast: "Disconnected",
    heading: "Connect Your Apps",
    description:
      "Connect the tools you use every day. Your AI can then use them automatically - no copy-pasting, no switching tabs.",
    connectedCount: (count: number) =>
      `${count} app${count !== 1 ? "s" : ""} connected`,
    loadingMore: "Loading...",
    loadMore: "Load more",
    skip: "Skip for now",
    primaryWithApps: "Start using Navigator",
    primaryWithoutApps: "Go to app",
    continueError: "Failed to continue",
  },
} satisfies Record<
  OnboardingLanguage,
  {
    connectedLabel: string;
    connectLabel: string;
    disconnectLabel: string;
    loadError: string;
    connectError: string;
    disconnectError: string;
    disconnectedToast: string;
    heading: string;
    description: string;
    connectedCount: (count: number) => string;
    loadingMore: string;
    loadMore: string;
    skip: string;
    primaryWithApps: string;
    primaryWithoutApps: string;
    continueError: string;
  }
>;

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  initialStep: OnboardingStep;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function markOnboardingDone() {
  const current = await fetch("/api/user/preferences").then((r) => r.json());
  const merged = {
    ...current,
    onboarding: {
      ...(current?.onboarding ?? {}),
      step: "done",
      completedAt: new Date().toISOString(),
    },
  };
  await fetch("/api/user/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(merged),
  });
}

function setOnboardingCookie() {
  document.cookie =
    "onboarding_complete=1; path=/; max-age=31536000; samesite=lax";
}

// ─── App Card ────────────────────────────────────────────────────────────────

function AppCard({
  toolkit,
  onConnect,
  onDisconnect,
  isConnecting,
  copy,
}: {
  toolkit: ComposioToolkit;
  onConnect: (slug: string) => void;
  onDisconnect: (connectedAccountId: string) => void;
  isConnecting: boolean;
  copy: (typeof connectAppsCopy)[OnboardingLanguage];
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center gap-3 p-4 rounded-xl border transition-all",
        toolkit.isConnected
          ? "border-green-500/50 bg-green-500/5"
          : "border-border hover:border-primary/40 hover:bg-secondary/40",
      )}
    >
      <div className="size-10 rounded-lg overflow-hidden flex items-center justify-center bg-background border border-border shrink-0">
        {toolkit.logo ? (
          <img
            src={toolkit.logo}
            alt={toolkit.name}
            className="size-8 object-contain"
          />
        ) : (
          <Plug className="size-5 text-muted-foreground" />
        )}
      </div>

      <p className="text-sm font-medium text-center leading-tight line-clamp-2">
        {toolkit.name}
      </p>

      {toolkit.isConnected && (
        <span className="absolute top-2 right-2 flex items-center gap-1 text-[10px] text-green-600 font-medium">
          <span className="size-1.5 rounded-full bg-green-500" />
          {copy.connectedLabel}
        </span>
      )}

      {toolkit.isConnected ? (
        <Button
          size="sm"
          variant="ghost"
          className="w-full text-xs h-7 text-muted-foreground hover:text-destructive"
          onClick={() =>
            toolkit.connectedAccountId &&
            onDisconnect(toolkit.connectedAccountId)
          }
        >
          {copy.disconnectLabel}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full text-xs h-7"
          disabled={isConnecting}
          onClick={() => onConnect(toolkit.slug)}
        >
          {isConnecting ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            copy.connectLabel
          )}
        </Button>
      )}
    </div>
  );
}

// ─── Connect Apps Step ────────────────────────────────────────────────────────

function ConnectAppsStep({
  language,
  onFinish,
}: {
  language: OnboardingLanguage;
  onFinish: () => void;
}) {
  const [toolkits, setToolkits] = useState<ComposioToolkit[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);

  const copy = connectAppsCopy[language];
  const connectedCount = toolkits.filter((t) => t.isConnected).length;

  const fetchPage = useCallback(
    async ({ cursor, append }: { cursor?: string; append: boolean }) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      try {
        const params = new URLSearchParams({
          paginate: "true",
          limit: String(ONBOARDING_PAGE_SIZE),
        });
        if (cursor) params.set("nextCursor", cursor);

        const res = await fetch(`/api/connections?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(copy.loadError);

        const data: {
          toolkits: ComposioToolkit[];
          nextCursor?: string | null;
        } = await res.json();

        setToolkits((prev) =>
          append ? [...prev, ...(data.toolkits ?? [])] : (data.toolkits ?? []),
        );
        setNextCursor(data.nextCursor ?? null);
      } catch {
        toast.error(copy.loadError);
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [copy.loadError],
  );

  useEffect(() => {
    fetchPage({ append: false });
  }, [fetchPage]);

  const handleConnect = useCallback(
    async (slug: string) => {
      setConnectingSlug(slug);
      try {
        const res = await fetch("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolkit: slug }),
        });
        if (!res.ok) throw new Error(copy.connectError);
        const { redirectUrl } = await res.json();
        window.location.href = redirectUrl;
      } catch (error: any) {
        toast.error(error.message ?? copy.connectError);
        setConnectingSlug(null);
      }
    },
    [copy.connectError],
  );

  const handleDisconnect = useCallback(
    async (connectedAccountId: string) => {
      try {
        const res = await fetch("/api/connections/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectedAccountId }),
        });
        if (!res.ok) throw new Error(copy.disconnectError);
        setToolkits((prev) =>
          prev.map((t) =>
            t.connectedAccountId === connectedAccountId
              ? { ...t, isConnected: false, connectedAccountId: undefined }
              : t,
          ),
        );
      } catch (error: any) {
        toast.error(error.message ?? copy.disconnectError);
      }
    },
    [copy.disconnectError, copy.disconnectedToast],
  );

  const handleFinish = async () => {
    setIsFinishing(true);
    try {
      await markOnboardingDone();
    } catch {
      // Non-fatal
    }
    setOnboardingCookie();
    onFinish();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center space-y-3">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Image
            src="/images/logo-3d.webp"
            alt="keinsaas navigator"
            width={40}
            height={40}
            priority
            className="shrink-0"
          />
          <span className="text-lg font-semibold tracking-tight">
            keinsaas navigator
          </span>
        </div>
        <h2 className="text-2xl font-bold">{copy.heading}</h2>
        <p className="text-muted-foreground max-w-sm mx-auto">
          {copy.description}
        </p>
        {connectedCount > 0 && (
          <p className="text-sm text-green-600 font-medium">
            {copy.connectedCount(connectedCount)}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-[130px] rounded-xl border border-border bg-secondary/30 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[420px] overflow-y-auto pr-1">
            {toolkits.map((toolkit) => (
              <AppCard
                key={toolkit.slug}
                toolkit={toolkit}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                isConnecting={connectingSlug === toolkit.slug}
                copy={copy}
              />
            ))}
          </div>
          {nextCursor && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                disabled={isLoadingMore}
                onClick={() => fetchPage({ cursor: nextCursor, append: true })}
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="size-3 mr-1 animate-spin" />
                    {copy.loadingMore}
                  </>
                ) : (
                  copy.loadMore
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button
          variant="ghost"
          className="flex-1 text-muted-foreground"
          onClick={handleFinish}
          disabled={isFinishing}
        >
          {copy.skip}
        </Button>
        <Button
          className="flex-1"
          onClick={handleFinish}
          disabled={isFinishing}
        >
          {isFinishing ? (
            <Loader2 className="size-4 animate-spin mr-2" />
          ) : (
            <ArrowRight className="size-4 mr-2" />
          )}
          {connectedCount > 0 ? copy.primaryWithApps : copy.primaryWithoutApps}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

async function setOnboardingStep(step: OnboardingStep) {
  const current = await fetch("/api/user/preferences").then((r) => r.json());
  const merged = {
    ...current,
    onboarding: {
      ...(current?.onboarding ?? {}),
      step,
    },
  };
  await fetch("/api/user/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(merged),
  });
}

export function OnboardingWizard({ initialStep }: Props) {
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [language, setLanguage] = useState<OnboardingLanguage>("de");
  const handleFinish = () => {
    window.location.href = "/";
  };

  const handleAutomationContinue = useCallback(async () => {
    try {
      await setOnboardingStep("connect_tools");
      setStep("connect_tools");
    } catch {
      toast.error(connectAppsCopy[language].continueError);
    }
  }, [language]);

  const handlePickPath = useCallback(async (href: string) => {
    try {
      await markOnboardingDone();
    } catch {
      // Non-fatal — middleware will redirect back if the cookie is also missing.
    }
    setOnboardingCookie();
    window.location.href = href;
  }, []);

  if (step === "automation_overview") {
    return (
      <AutomationOverviewStep
        language={language}
        onLanguageChange={setLanguage}
        onContinue={handleAutomationContinue}
        onPickPath={handlePickPath}
      />
    );
  }

  return (
    <div className="w-full max-w-2xl">
      <ConnectAppsStep language={language} onFinish={handleFinish} />
    </div>
  );
}

"use client";

import Image from "next/image";
import { ArrowRight, Sparkles, Wand2 } from "lucide-react";
import { Button } from "ui/button";
import { cn } from "lib/utils";

export type OnboardingLanguage = "de" | "en";

const overviewCopy = {
  de: {
    headline: "Womit sparen wir euch zuerst Zeit?",
    paths: [
      {
        title: "Einfache Aufgaben selbst automatisieren",
        description:
          "Nutzt einen fertigen Agenten oder beschreibt kurz, was passieren soll.",
        examples: ["Recherche-Agent", "CRM-Manager", "Sales Coach"],
        ctaLabel: "Agenten ansehen",
      },
      {
        title: "Komplexe Abläufe mit uns bauen",
        description:
          "Ladet euren Workflow hoch und wir führen euch entspannt durch den Rest.",
        examples: ["Voice", "Screen Recording", "Dokument-Upload"],
        ctaLabel: "Onboarding starten",
      },
    ],
    skipLabel: "Erstmal überspringen",
  },
  en: {
    headline: "Pick how you wanna start automating",
    paths: [
      {
        title: "Automate simple tasks yourself",
        description: "Use a pre-built agent or describe the task.",
        examples: ["Research Agent", "CRM Manager", "Sales Coach"],
        ctaLabel: "Browse agents",
      },
      {
        title: "Let us handle the complex stuff",
        description: "Upload your workflow and follow the magic.",
        examples: ["Voice", "Screen recording", "Document upload"],
        ctaLabel: "Start onboarding",
      },
    ],
    skipLabel: "Skip for now",
  },
} satisfies Record<
  OnboardingLanguage,
  {
    headline: string;
    paths: {
      title: string;
      description: string;
      examples: string[];
      ctaLabel: string;
    }[];
    skipLabel: string;
  }
>;

interface AutomationOverviewStepProps {
  language: OnboardingLanguage;
  onLanguageChange: (language: OnboardingLanguage) => void;
  onContinue: () => void;
  onPickPath: (href: string) => void;
}

function ExampleChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs text-muted-foreground bg-foreground/5 border border-border/60">
      {label}
    </span>
  );
}

function PathCard({
  index,
  icon: Icon,
  title,
  description,
  examples,
  ctaLabel,
  onPick,
}: {
  index: number;
  icon: typeof Sparkles;
  title: string;
  description: string;
  examples: string[];
  ctaLabel: string;
  onPick: () => void;
}) {
  return (
    <div className="flex flex-col gap-5 p-6 lg:p-7 rounded-2xl border border-border bg-card hover:border-primary/40 transition-colors">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm">
          {index}
        </div>
        <Icon className="size-4 text-muted-foreground" />
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {examples.map((label) => (
          <ExampleChip key={label} label={label} />
        ))}
      </div>

      <Button className="w-full mt-auto" size="lg" onClick={onPick}>
        {ctaLabel}
        <ArrowRight className="size-4 ml-2" />
      </Button>
    </div>
  );
}

export function AutomationOverviewStep({
  language,
  onLanguageChange,
  onContinue,
  onPickPath,
}: AutomationOverviewStepProps) {
  const copy = overviewCopy[language];

  return (
    <div className="w-full max-w-3xl">
      <div className="text-center mb-8">
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="w-[78px]" aria-hidden="true" />
          <div className="flex items-center justify-center gap-2">
            <Image
              src="/images/logo-3d.webp"
              alt=""
              width={36}
              height={36}
              priority
              className="shrink-0"
            />
            <span className="hidden text-base font-semibold tracking-tight sm:inline">
              keinsaas navigator
            </span>
          </div>
          <div
            className="inline-flex rounded-full border border-border bg-background p-0.5"
            aria-label="Language"
          >
            {(["de", "en"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={language === option}
                onClick={() => onLanguageChange(option)}
                className={cn(
                  "h-8 min-w-9 rounded-full px-3 text-xs font-medium transition-colors",
                  language === option
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight">
          {copy.headline}
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <PathCard
          index={1}
          icon={Sparkles}
          title={copy.paths[0].title}
          description={copy.paths[0].description}
          examples={copy.paths[0].examples}
          ctaLabel={copy.paths[0].ctaLabel}
          onPick={() => onPickPath("/agents")}
        />
        <PathCard
          index={2}
          icon={Wand2}
          title={copy.paths[1].title}
          description={copy.paths[1].description}
          examples={copy.paths[1].examples}
          ctaLabel={copy.paths[1].ctaLabel}
          onPick={() => onPickPath("/workflow")}
        />
      </div>

      <div className="flex justify-center mt-6">
        <button
          type="button"
          onClick={onContinue}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {copy.skipLabel}
        </button>
      </div>
    </div>
  );
}

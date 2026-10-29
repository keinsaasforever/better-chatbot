"use client";

import { IS_CLOUD_EDITION } from "@/lib/edition";
import { useState } from "react";
import { Button } from "ui/button";
import { OnboardingStepGoal } from "./onboarding-step-goal";
import { OnboardingStepDocuments } from "./onboarding-step-documents";
import { OnboardingStepTools } from "./onboarding-step-tools";
import { OnboardingStepPeople } from "./onboarding-step-people";
import { OnboardingStepAgents } from "./onboarding-step-agents";

const ALL_STEPS = ["Goal", "Documents", "Tools", "People", "Agents"] as const;
type Step = (typeof ALL_STEPS)[number];

// Sharing a project with teammates needs an organization to draw members
// from, which only the hosted product has.
const STEPS: readonly Step[] = IS_CLOUD_EDITION
  ? ALL_STEPS
  : ALL_STEPS.filter((step) => step !== "People");

export function ProjectOnboardingContent({
  projectId,
  onComplete,
}: {
  projectId: string;
  onComplete: (data: {
    goal: string;
    memberUserIds: string[];
  }) => Promise<void>;
}) {
  const [step, setStep] = useState<Step>("Goal");
  const [goal, setGoal] = useState("");
  const [memberUserIds, setMemberUserIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const currentIndex = STEPS.indexOf(step);
  const isLast = currentIndex === STEPS.length - 1;

  const handleNext = async () => {
    if (isLast) {
      setSubmitting(true);
      try {
        await onComplete({ goal, memberUserIds });
      } finally {
        setSubmitting(false);
      }
      return;
    }
    setStep(STEPS[currentIndex + 1] as Step);
  };

  const handleBack = () => {
    if (currentIndex > 0) {
      setStep(STEPS[currentIndex - 1] as Step);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <nav className="mb-6 flex gap-2">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              s === step
                ? "bg-primary text-primary-foreground"
                : i < currentIndex
                  ? "bg-muted text-foreground"
                  : "bg-muted/40 text-muted-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </nav>

      <div className="flex-1">
        {step === "Goal" && (
          <OnboardingStepGoal goal={goal} onChange={setGoal} />
        )}
        {step === "Documents" && (
          <OnboardingStepDocuments projectId={projectId} />
        )}
        {step === "Tools" && <OnboardingStepTools projectId={projectId} />}
        {step === "People" && (
          <OnboardingStepPeople
            memberUserIds={memberUserIds}
            onChange={setMemberUserIds}
          />
        )}
        {step === "Agents" && <OnboardingStepAgents projectId={projectId} />}
      </div>

      <div className="mt-6 flex justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentIndex === 0}
        >
          Back
        </Button>
        <Button onClick={handleNext} disabled={submitting}>
          {isLast ? (submitting ? "Setting up…" : "Finish setup") : "Next"}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { ProjectToolPicker } from "./project-tool-picker";

export function OnboardingStepTools({ projectId }: { projectId: string }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect tools to let the brain automatically pull data every day and
        keep your todos and status widgets up to date.
      </p>
      <ProjectToolPicker projectId={projectId} />
    </div>
  );
}

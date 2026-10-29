"use client";

import { Textarea } from "ui/textarea";
import { Label } from "ui/label";

export function OnboardingStepGoal({
  goal,
  onChange,
}: {
  goal: string;
  onChange: (goal: string) => void;
}) {
  return (
    <div className="space-y-3">
      <Label htmlFor="project-goal">What is the goal of this project?</Label>
      <Textarea
        id="project-goal"
        placeholder="Describe what you want to achieve with this project..."
        value={goal}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="resize-none"
      />
    </div>
  );
}

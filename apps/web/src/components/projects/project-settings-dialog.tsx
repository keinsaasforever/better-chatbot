"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Textarea } from "ui/textarea";

type ProjectSettingsDialogProject = {
  id: string;
  name: string;
  description: string | null;
  goal?: string | null;
  systemPrompt?: string | null;
};

export function ProjectSettingsDialog({
  project,
  open,
  onOpenChange,
}: {
  project: ProjectSettingsDialogProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [goal, setGoal] = useState(project.goal ?? "");
  const [systemPrompt, setSystemPrompt] = useState(project.systemPrompt ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setName(project.name);
      setDescription(project.description ?? "");
      setGoal(project.goal ?? "");
      setSystemPrompt(project.systemPrompt ?? "");
    }
    onOpenChange(nextOpen);
  };

  const save = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description.trim() || null,
          goal: goal.trim() || null,
          systemPrompt: systemPrompt.trim() || null,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "Could not save project settings.",
        );
      }

      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save project settings.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>
            Update this project's name, goal, and instructions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-settings-name">Name</Label>
            <Input
              id="project-settings-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-settings-description">Description</Label>
            <Textarea
              id="project-settings-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this project about?"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-settings-goal">Goal</Label>
            <Textarea
              id="project-settings-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="What outcome is this project working toward?"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-settings-system-prompt">
              System prompt
            </Label>
            <Textarea
              id="project-settings-system-prompt"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="Custom instructions for this project's chat and brain updates…"
              maxLength={8000}
              rows={6}
            />
            <p className="text-xs text-muted-foreground">
              Steers project chat and how the project brain gathers data and
              generates widgets.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={!name.trim() || isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

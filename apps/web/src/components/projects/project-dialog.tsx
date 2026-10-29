"use client";

import { type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "ui/dialog";
import { Input } from "ui/input";
import { Textarea } from "ui/textarea";
import { requireCredits } from "@/lib/billing/require-credits";
import type { AgentsetEmbeddingProfileId } from "@/types/project";
import { EmbeddingModelSelector } from "./embedding-model-selector";

export function ProjectDialog({
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (nextOpen: boolean) => {
    setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [embeddingProfile, setEmbeddingProfile] =
    useState<AgentsetEmbeddingProfileId>("agentset-managed");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createProject = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || undefined,
          embeddingProfile,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not create project.");
      }

      setOpen(false);
      router.push(`/projects/${payload.project.id}?onboard=1`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create project.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span
        onClick={() => {
          // Gate the opener, not `createProject`: no point letting the user
          // fill in the form and only then refusing.
          if (!requireCredits()) return;
          setOpen(true);
        }}
      >
        {children}
      </span>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Project name"
            autoFocus
          />
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is this project about?"
          />
          <EmbeddingModelSelector
            value={embeddingProfile}
            onChange={setEmbeddingProfile}
          />
          <Button
            className="w-full"
            disabled={!name.trim() || isSubmitting}
            onClick={createProject}
          >
            {isSubmitting ? "Creating…" : "Create project"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

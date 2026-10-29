"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { ProjectToolPicker } from "./project-tool-picker";

/** Brain-tab entry point for attaching Composio tools after onboarding. */
export function ProjectAddToolDialog({
  projectId,
  open,
  onOpenChange,
  onAttached,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttached?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add tools</DialogTitle>
          <DialogDescription>
            Connect apps or add already-connected ones to this project. The
            brain syncs them to keep the project widgets fresh.
          </DialogDescription>
        </DialogHeader>
        <ProjectToolPicker projectId={projectId} onAttached={onAttached} />
      </DialogContent>
    </Dialog>
  );
}

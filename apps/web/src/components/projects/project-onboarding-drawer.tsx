"use client";

import { Sparkles } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "ui/drawer";
import { ProjectOnboardingContent } from "./project-onboarding-content";

export function ProjectOnboardingDrawer({
  open,
  onOpenChange,
  project,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: { id: string; name: string };
}) {
  const handleComplete = async (data: {
    goal: string;
    memberUserIds: string[];
  }) => {
    await fetch(`/api/projects/${project.id}/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="top">
      <DrawerContent className="h-[92vh] overflow-hidden">
        <DrawerTitle className="sr-only">Project Setup</DrawerTitle>
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-2 border-b px-6 py-4">
            <Sparkles className="size-5" />
            <div>
              <h2 className="text-lg font-semibold">Set up {project.name}</h2>
              <p className="text-sm text-muted-foreground">
                Configure your project brain in a few steps
              </p>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <ProjectOnboardingContent
              projectId={project.id}
              onComplete={handleComplete}
            />
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

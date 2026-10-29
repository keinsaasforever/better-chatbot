"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "ui/button";
import { ProjectUploadDialog } from "./project-upload-dialog";

export function OnboardingStepDocuments({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Upload PDFs, docs, or other files to build the project knowledge base.
      </p>
      <div className="flex items-center justify-center rounded-lg border border-dashed p-8">
        <div className="text-center">
          <FileText className="mx-auto mb-3 size-10 text-muted-foreground" />
          <p className="mb-3 text-sm text-muted-foreground">
            Add documents to your project brain
          </p>
          <Button variant="outline" onClick={() => setOpen(true)}>
            Upload documents
          </Button>
        </div>
      </div>
      <ProjectUploadDialog
        projectId={projectId}
        isOpen={open}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, X, Upload, CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { mutate } from "swr";
import { formatBytes } from "@/lib/utils";

interface ProjectUploadDialogProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onUploadComplete?: () => void;
}

export function ProjectUploadDialog({
  projectId,
  isOpen,
  onClose,
  onUploadComplete,
}: ProjectUploadDialogProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleUpload = async () => {
    setIsUploading(true);
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileLabel = `${i + 1}/${files.length}`;
      try {
        setProgressLabel(`Uploading ${fileLabel} to storage…`);
        // Step 1: Get signed upload URL
        const tokenResponse = await fetch("/api/storage/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            uploadType: "attachment",
          }),
        });

        if (!tokenResponse.ok) {
          throw new Error("Failed to get upload URL");
        }

        const { token, path, bucketName, tusEndpoint } =
          await tokenResponse.json();

        // Step 2: Upload file using TUS (bypasses Vercel size limit)
        await new Promise<void>((resolve, reject) => {
          // Dynamically import tus-js-client
          import("tus-js-client").then((tus) => {
            const upload = new tus.Upload(file, {
              endpoint: tusEndpoint,
              retryDelays: [0, 3000, 5000, 10000, 20000],
              headers: {
                // Use Bearer token format for Supabase TUS uploads
                Authorization: `Bearer ${token}`,
              },
              uploadDataDuringCreation: true,
              removeFingerprintOnSuccess: true,
              metadata: {
                bucketName,
                objectName: path,
                contentType: file.type,
                cacheControl: "3600",
              },
              chunkSize: 6 * 1024 * 1024, // 6MB chunks
              onError: (error) => {
                reject(new Error(`Upload failed: ${error.message}`));
              },
              onProgress: (bytesUploaded, bytesTotal) => {
                const progress = Math.round((bytesUploaded / bytesTotal) * 100);
                console.log(`Upload progress: ${progress}%`);
              },
              onSuccess: () => {
                resolve();
              },
            });

            upload
              .findPreviousUploads()
              .then((previousUploads) => {
                if (previousUploads.length > 0) {
                  upload.resumeFromPreviousUpload(previousUploads[0]);
                }
                upload.start();
              })
              .catch(reject);
          });
        });

        setProgressLabel(`Chunking & embedding ${fileLabel}…`);
        // Step 3: Notify server to process the uploaded file for RAG
        const processRes = await fetch(
          `/api/projects/${projectId}/process-upload`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              storageKey: path,
              filename: file.name,
              contentType: file.type,
            }),
          },
        );

        if (!processRes.ok) {
          const body = (await processRes.json().catch(() => null)) as {
            details?: string;
            error?: string;
          } | null;
          const detail = body?.details ?? body?.error;
          throw new Error(
            detail
              ? `Knowledge base ingestion failed: ${detail}`
              : "Failed to process file for RAG",
          );
        }

        successCount++;
        void mutate(`/api/projects/${projectId}/status`);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : `Failed to upload ${file.name}`;
        toast.error(message);
        console.error(error);
      }
    }

    setIsUploading(false);
    setProgressLabel(null);
    if (successCount > 0) {
      setFiles([]);
      onUploadComplete?.();
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Documents</DialogTitle>
          <DialogDescription>
            Add PDFs to your knowledge base. Files are uploaded to storage, then
            indexed in Agentset for retrieval.
          </DialogDescription>
        </DialogHeader>

        {progressLabel && (
          <p className="text-sm text-muted-foreground flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            {progressLabel}
          </p>
        )}

        <div className="space-y-4">
          {/* File Dropzone */}
          <div className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:bg-muted/50 transition-colors relative">
            <CloudUpload className="w-8 h-8" />
            <p>Click to select files (PDF, CSV, TXT, MD)</p>
            <input
              type="file"
              multiple
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={handleFileSelect}
              accept=".pdf,.csv,.txt,.md"
            />
          </div>

          {/* Selected Files List */}
          {files.length > 0 && (
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              <h4 className="font-medium text-sm">
                Selected Files ({files.length})
              </h4>
              {files.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 rounded border"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <FileText className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      ({formatBytes(file.size)})
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setFiles(files.filter((_, i) => i !== index))
                    }
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={files.length === 0 || isUploading}
          >
            {isUploading ? (
              "Working…"
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Upload {files.length} {files.length === 1 ? "File" : "Files"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

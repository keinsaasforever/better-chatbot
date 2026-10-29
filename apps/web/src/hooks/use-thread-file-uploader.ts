"use client";

import { useCallback } from "react";
import { appStore, UploadedFile } from "@/app/store";
import { useFileUpload } from "@/hooks/use-presigned-upload";
import { generateUUID } from "@/lib/utils";
import { toast } from "sonner";

export function useThreadFileUploader(threadId?: string) {
  const appStoreMutate = appStore((s) => s.mutate);
  const { upload } = useFileUpload();

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!threadId || files.length === 0) return;
      const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB per file

      for (const file of files) {
        if (file.size > MAX_SIZE_BYTES) {
          toast.error(`${file.name}: file too large (>50MB)`);
          continue;
        }

        const previewUrl = file.type?.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined;
        const fileId = generateUUID();
        const abortController = new AbortController();

        const uploadingFile: UploadedFile = {
          id: fileId,
          url: "",
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          isUploading: true,
          progress: 0,
          previewUrl,
          abortController,
        };

        appStoreMutate((prev) => ({
          threadFiles: {
            ...prev.threadFiles,
            [threadId]: [...(prev.threadFiles[threadId] ?? []), uploadingFile],
          },
        }));

        try {
          const uploaded = await upload(file);
          if (uploaded) {
            appStoreMutate((prev) => ({
              threadFiles: {
                ...prev.threadFiles,
                [threadId]: (prev.threadFiles[threadId] ?? []).map((f) =>
                  f.id === fileId
                    ? {
                        ...f,
                        url: uploaded.url,
                        isUploading: false,
                        progress: 100,
                      }
                    : f,
                ),
              },
            }));
          } else {
            appStoreMutate((prev) => ({
              threadFiles: {
                ...prev.threadFiles,
                [threadId]: (prev.threadFiles[threadId] ?? []).filter(
                  (f) => f.id !== fileId,
                ),
              },
            }));
          }
        } catch (_err) {
          appStoreMutate((prev) => ({
            threadFiles: {
              ...prev.threadFiles,
              [threadId]: (prev.threadFiles[threadId] ?? []).filter(
                (f) => f.id !== fileId,
              ),
            },
          }));
        } finally {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
        }
      }
    },
    [threadId, appStoreMutate, upload],
  );

  return { uploadFiles };
}

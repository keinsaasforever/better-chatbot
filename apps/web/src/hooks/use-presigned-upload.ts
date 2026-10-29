"use client";

import { authClient } from "@/lib/auth/client";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import * as tus from "tus-js-client";

// Types
interface UploadResult {
  pathname: string;
  url: string;
  contentType?: string;
  size?: number;
}

export interface FileUploadOptions {
  /**
   * Type of upload - determines which bucket to use:
   * - "avatar": Uploads to avatars bucket (public, for profile pictures)
   * - "attachment": Uploads to attachments bucket (private, for chat files)
   * Default: "attachment"
   */
  uploadType?: "avatar" | "attachment";
  /**
   * Callback for upload progress (0-100)
   */
  onProgress?: (progress: number) => void;
}

/**
 * Hook for uploading files to Supabase Storage using TUS Resumable Uploads.
 *
 * Uses client-side TUS protocol to upload directly to Supabase Storage,
 * bypassing Vercel's 4.5MB body size limit. Server provides signed upload tokens
 * after validating user via Better Auth.
 *
 * Files are uploaded to: ${userId}/${fileId}-${sanitized-filename}
 *
 * Benefits:
 * - Supports files up to 50GB (vs 4.5MB server limit)
 * - Resumable uploads (handles network interruptions)
 * - Progress tracking
 * - Works with Better Auth (no need for Supabase Auth)
 * - Files are isolated per-user
 * - Support for multiple buckets (avatars/attachments)
 *
 * @example
 * ```tsx
 * // Upload chat attachment (default)
 * function FileUpload() {
 *   const { upload, isUploading } = useFileUpload();
 *   const result = await upload(file);
 * }
 *
 * // Upload avatar with progress
 * function AvatarUpload() {
 *   const { upload, isUploading } = useFileUpload({
 *     uploadType: "avatar",
 *     onProgress: (progress) => console.log(`${progress}%`)
 *   });
 *   const result = await upload(file);
 * }
 * ```
 */
export function useFileUpload(options: FileUploadOptions = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const uploadType = options.uploadType || "attachment";
  const onProgress = options.onProgress;

  const upload = useCallback(
    async (file: File): Promise<UploadResult | undefined> => {
      if (!(file instanceof File)) {
        toast.error("Upload expects a File instance");
        return;
      }

      setIsUploading(true);
      try {
        // Public URLs are built from the Supabase project URL. Without it a
        // successful upload would resolve to an unusable link, so fail early.
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error(
            "File uploads require NEXT_PUBLIC_SUPABASE_URL — see docs/self-hosting.md#storage",
          );
        }

        // Verify user is logged in
        const session = await authClient.getSession();
        if (!session?.data?.user?.id) {
          toast.error("You must be logged in to upload files");
          return;
        }

        // Get signed upload URL from server
        const tokenResponse = await fetch("/api/storage/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            uploadType,
          }),
        });

        if (!tokenResponse.ok) {
          const errorData = await tokenResponse.json().catch(() => ({}));
          throw new Error(
            errorData.error ||
              `Failed to get upload URL: ${tokenResponse.statusText}`,
          );
        }

        const { token, path, bucketName, tusEndpoint } =
          await tokenResponse.json();

        // Upload file using TUS protocol
        return new Promise<UploadResult>((resolve, reject) => {
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
            chunkSize: 6 * 1024 * 1024, // 6MB chunks (required by Supabase)
            onError: (error) => {
              console.error("TUS upload error:", error);
              reject(new Error(`Upload failed: ${error.message}`));
            },
            onProgress: (bytesUploaded, bytesTotal) => {
              const progress = Math.round((bytesUploaded / bytesTotal) * 100);
              onProgress?.(progress);
            },
            onSuccess: () => {
              // For public buckets, construct public URL
              const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucketName}/${path}`;

              resolve({
                pathname: path,
                url: publicUrl, // Public URL for direct access by LLMs and users
                contentType: file.type,
                size: file.size,
              });
            },
          });

          // Check for previous uploads and resume if found
          upload
            .findPreviousUploads()
            .then((previousUploads) => {
              if (previousUploads.length > 0) {
                upload.resumeFromPreviousUpload(previousUploads[0]);
              }
              upload.start();
            })
            .catch((error) => {
              reject(new Error(`Failed to start upload: ${error.message}`));
            });
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Upload failed";
        console.error("Upload error:", error);
        toast.error(message);
        return;
      } finally {
        setIsUploading(false);
      }
    },
    [uploadType, onProgress],
  );

  return {
    upload,
    isUploading,
  };
}

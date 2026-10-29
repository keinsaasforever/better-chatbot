"use server";

import { storageDriver } from "lib/file-storage";

/**
 * Get storage configuration info.
 * Used by clients to determine upload strategy.
 */
export async function getStorageInfoAction() {
  return {
    type: storageDriver,
    supportsDirectUpload: false, // Supabase uses server upload
  };
}

interface StorageCheckResult {
  isValid: boolean;
  error?: string;
  solution?: string;
}

/**
 * Check if storage is properly configured.
 * Returns detailed error messages with solutions.
 */
export async function checkStorageAction(): Promise<StorageCheckResult> {
  // Check Supabase configuration
  if (storageDriver === "supabase") {
    if (!process.env.SUPABASE_URL) {
      return {
        isValid: false,
        error: "SUPABASE_URL is not set",
        solution:
          "Please configure Supabase Storage:\n" +
          "1. Add SUPABASE_URL to your environment variables\n" +
          "2. Add SUPABASE_SERVICE_ROLE_KEY to your environment variables\n" +
          "3. Create the following buckets in your Supabase project (Storage section):\n" +
          "   - 'avatars' (public, for profile pictures)\n" +
          "   - 'attachments' (public/private, for chat files)\n" +
          "   - 'Gemini Images' (public, for AI-generated images)\n" +
          "4. Make the avatars and AI-generated image buckets public",
      };
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return {
        isValid: false,
        error: "SUPABASE_SERVICE_ROLE_KEY is not set",
        solution:
          "Please add SUPABASE_SERVICE_ROLE_KEY to your environment variables.\n" +
          "You can find this in your Supabase project settings under API.",
      };
    }
  }

  // Validate storage driver (we only support Supabase)
  if (storageDriver !== "supabase") {
    return {
      isValid: false,
      error: `Invalid storage driver: ${storageDriver}`,
      solution:
        "FILE_STORAGE_TYPE must be 'supabase' (or omit it to use default Supabase storage)",
    };
  }

  return {
    isValid: true,
  };
}

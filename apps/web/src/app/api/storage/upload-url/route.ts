import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { createClient } from "@supabase/supabase-js";
import { generateUUID } from "lib/utils";
import path from "node:path";
import { sanitizeFilename } from "@/lib/file-storage/storage-utils";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ATTACHMENT_BUCKET =
  process.env.SUPABASE_ATTACHMENT_BUCKET || "attachments";
const AVATAR_BUCKET = process.env.SUPABASE_AVATAR_BUCKET || "avatars";

// Extract project ID from Supabase URL
const getProjectId = () => {
  if (!SUPABASE_URL) return null;
  const match = SUPABASE_URL.match(/https:\/\/([^.]+)\./);
  return match ? match[1] : null;
};

/**
 * Upload URL endpoint for Supabase Storage with TUS Resumable Uploads.
 *
 * Returns a signed upload token that allows client-side resumable uploads
 * directly to Supabase Storage, bypassing Vercel's 4.5MB body size limit.
 *
 * Supports files up to 50GB using the TUS protocol.
 */
export const POST = withAuth(async (request: Request, session) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 },
    );
  }

  try {
    const { filename, uploadType = "attachment" } = await request.json();

    if (!filename) {
      return NextResponse.json(
        { error: "filename is required" },
        { status: 400 },
      );
    }

    // Determine bucket based on upload type
    const bucketName =
      uploadType === "avatar" ? AVATAR_BUCKET : ATTACHMENT_BUCKET;

    // Generate unique path: userId/uuid-sanitized-filename
    const id = generateUUID();
    const safeFilename = sanitizeFilename(filename);
    const uploadPath = path.posix.join(
      session.user.id,
      `${id}-${safeFilename}`,
    );

    // Create Supabase client with service role key
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Create signed upload URL (valid for 24 hours)
    const { data, error } = await supabase.storage
      .from(bucketName)
      .createSignedUploadUrl(uploadPath, {
        upsert: true,
      });

    if (error) {
      console.error("Failed to create signed upload URL:", error);
      return NextResponse.json(
        { error: "Failed to create upload URL" },
        { status: 500 },
      );
    }

    const projectId = getProjectId();
    if (!projectId) {
      return NextResponse.json(
        { error: "Invalid Supabase URL configuration" },
        { status: 500 },
      );
    }

    // Return signed token and TUS endpoint
    return NextResponse.json({
      token: data.token,
      path: data.path,
      bucketName,
      // Use direct storage hostname for better performance
      tusEndpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable`,
      // Fallback for old clients
      fallbackUrl: "/api/storage/upload",
    });
  } catch (error) {
    console.error("Upload URL creation error:", error);
    return NextResponse.json(
      { error: "Failed to create upload URL" },
      { status: 500 },
    );
  }
});

import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";

/**
 * Register an uploaded file attachment in the database (optional).
 * This endpoint is called after successful client-side upload to Supabase Storage.
 *
 * Purpose:
 * - Track file uploads for analytics
 * - Link attachments to specific threads/chats
 * - Enable file management UI
 * - Support cleanup of orphaned files
 *
 * Note: This is optional - uploads work without database tracking.
 */
export const POST = withAuth(async (request, session) => {
  try {
    const userId = session.user.id;

    // Parse request body
    const body = await request.json();
    const { storagePath, filename, mimeType } = body;

    // Validate required fields
    if (!storagePath || !filename || !mimeType) {
      return NextResponse.json(
        { error: "Missing required fields: storagePath, filename, mimeType" },
        { status: 400 },
      );
    }

    // Security: Verify the storage path belongs to this user
    // Paths should be: ${userId}/${fileId}-${filename}
    if (!storagePath.startsWith(`${userId}/`)) {
      return NextResponse.json(
        { error: "Invalid storage path - must be in your user folder" },
        { status: 403 },
      );
    }

    // TODO: Save to database if attachments table exists
    // Example:
    // await db.attachments.create({
    //   userId,
    //   threadId: threadId || null,
    //   storagePath,
    //   filename,
    //   mimeType,
    //   sizeBytes: size || 0,
    //   createdAt: new Date(),
    // });

    // For now, just acknowledge success
    // The upload already succeeded in Supabase Storage
    return NextResponse.json({
      success: true,
      message: "Attachment registered successfully",
    });
  } catch (error) {
    console.error("Error registering attachment:", error);
    return NextResponse.json(
      { error: "Failed to register attachment" },
      { status: 500 },
    );
  }
});

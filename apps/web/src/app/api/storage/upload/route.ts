import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { serverFileStorage, storageDriver } from "lib/file-storage";
import { checkStorageAction } from "../actions";

// Increase body size limit to 6MB (matches Supabase's recommended standard upload limit)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "6mb",
    },
  },
};

export const POST = withAuth(async (request: Request, session) => {
  // Check storage configuration first
  const storageCheck = await checkStorageAction();
  if (!storageCheck.isValid) {
    return NextResponse.json(
      {
        error: storageCheck.error,
        solution: storageCheck.solution,
        storageDriver,
      },
      { status: 500 },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const uploadType = (formData.get("uploadType") as string) || "attachment";

    if (!file) {
      return NextResponse.json(
        { error: "No file provided. Use 'file' field in FormData." },
        { status: 400 },
      );
    }

    // Validate upload type
    if (!["avatar", "attachment"].includes(uploadType)) {
      return NextResponse.json(
        { error: "Invalid uploadType. Must be 'avatar' or 'attachment'." },
        { status: 400 },
      );
    }

    // Read file content
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to storage with userId and uploadType for proper bucket selection
    const result = await serverFileStorage.upload(buffer, {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      userId: session.user.id,
      uploadType: uploadType as "avatar" | "attachment",
    });

    return NextResponse.json({
      success: true,
      key: result.key,
      url: result.sourceUrl,
      metadata: result.metadata,
    });
  } catch (error) {
    console.error("Failed to upload file", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 },
    );
  }
});

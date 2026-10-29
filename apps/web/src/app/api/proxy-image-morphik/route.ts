import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";

/**
 * Image proxy to bypass CORS and handle pre-signed S3 URLs
 * Used for Morphik MCP results and other external images
 */
export const GET = withAuth(async (request, _session) => {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get("url");

  if (!imageUrl) {
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 400 },
    );
  }

  // Validate URL is from allowed domains (security)
  const allowedDomains = [
    "morphik-storage.s3.amazonaws.com",
    "s3.amazonaws.com",
    // Add other trusted domains as needed
  ];

  try {
    const parsedUrl = new URL(imageUrl);
    const isAllowed = allowedDomains.some((domain) =>
      parsedUrl.hostname.includes(domain),
    );

    if (!isAllowed) {
      return NextResponse.json(
        { error: "Domain not allowed" },
        { status: 403 },
      );
    }

    // Fetch the image from the pre-signed URL
    const imageResponse = await fetch(imageUrl, {
      method: "GET",
      headers: {
        // Don't pass frontend cookies/auth to S3
      },
    });

    if (!imageResponse.ok) {
      console.error(
        `[Image Proxy] Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`,
      );
      return NextResponse.json(
        { error: `Failed to fetch image: ${imageResponse.statusText}` },
        { status: imageResponse.status },
      );
    }

    // Get the image data
    const imageBuffer = await imageResponse.arrayBuffer();
    const contentType =
      imageResponse.headers.get("content-type") || "image/png";

    // Return the image with appropriate headers
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
        "Access-Control-Allow-Origin": "*", // Allow CORS
      },
    });
  } catch (error) {
    console.error("[Image Proxy] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to proxy image",
      },
      { status: 500 },
    );
  }
});

import { withAuth } from "auth/route-guard";
import { NextResponse } from "next/server";

/**
 * Generate a temporary AssemblyAI token for authenticated users
 * This keeps the API key secure on the server side
 */
export const POST = withAuth(async (_request, _session) => {
  try {
    // Check if AssemblyAI API key is configured
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) {
      console.error("ASSEMBLYAI_API_KEY is not configured");
      return NextResponse.json(
        { error: "AssemblyAI service not configured" },
        { status: 503 },
      );
    }

    // Generate temporary token from AssemblyAI v3 API
    // Max expiration is 600 seconds (10 minutes) for v3 API
    const response = await fetch(
      "https://streaming.eu.assemblyai.com/v3/token?expires_in_seconds=600",
      {
        method: "GET",
        headers: {
          authorization: apiKey,
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AssemblyAI token generation failed:", errorText);
      return NextResponse.json(
        { error: "Failed to generate token" },
        { status: 500 },
      );
    }

    const data = await response.json();

    return NextResponse.json({ token: data.token });
  } catch (error) {
    console.error("AssemblyAI token generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate token" },
      { status: 500 },
    );
  }
});

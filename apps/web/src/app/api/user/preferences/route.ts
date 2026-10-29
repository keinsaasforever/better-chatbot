import { withAuth } from "auth/route-guard";
import { UserPreferencesZodSchema } from "app-types/user";
import { userRepository } from "lib/db/repository";
import { NextResponse } from "next/server";

export const GET = withAuth(async (_request, session) => {
  try {
    const preferences = await userRepository.getPreferences(session.user.id);
    return NextResponse.json(preferences ?? {});
  } catch (error) {
    console.error("Failed to get preferences:", error);
    return NextResponse.json(
      { error: "Failed to get preferences" },
      { status: 500 },
    );
  }
});

export const PUT = withAuth(async (request: Request, session) => {
  try {
    const json = await request.json();
    const preferences = UserPreferencesZodSchema.parse(json);
    const updatedUser = await userRepository.updatePreferences(
      session.user.id,
      preferences,
    );
    return NextResponse.json({
      success: true,
      preferences: updatedUser.preferences,
    });
  } catch (error) {
    console.error("Failed to update preferences:", error);
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 },
    );
  }
});

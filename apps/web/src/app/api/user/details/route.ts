import { withAuth } from "auth/route-guard";
import { getUser } from "lib/user/server";
import { NextResponse } from "next/server";

export const GET = withAuth(async (_request, session) => {
  try {
    const user = await getUser(session.user.id);
    return NextResponse.json(user ?? {});
  } catch (error) {
    console.error("Failed to get user details:", error);
    return NextResponse.json(
      { error: "Failed to get user details" },
      { status: 500 },
    );
  }
});

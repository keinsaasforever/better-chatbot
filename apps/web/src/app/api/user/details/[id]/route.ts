import { withAuth } from "auth/route-guard";
import { getUser } from "lib/user/server";
import { canManageUser } from "lib/auth/permissions";
import { NextResponse, NextRequest } from "next/server";

export const GET = withAuth(
  async (
    _request: NextRequest,
    _session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;

      // Use our new permission system: user can get own details OR admin can get any user's details
      if (!(await canManageUser(id))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const user = await getUser(id);
      return NextResponse.json(user ?? {});
    } catch (error) {
      console.error("Failed to get user details:", error);
      return NextResponse.json(
        { error: "Failed to get user details" },
        { status: 500 },
      );
    }
  },
);

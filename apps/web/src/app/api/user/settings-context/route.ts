import { withAuth } from "auth/route-guard";
import {
  getUser,
  getUserAccounts,
  getUserIdAndCheckAccess,
} from "lib/user/server";
import { NextResponse } from "next/server";

/**
 * Aggregates everything the user-settings drawer needs in one call, fetched
 * client-side only when the drawer opens (see UserSettingsPopup). Previously the
 * (chat) layout rendered this server-side on every page load for a rarely
 * opened popup. Self-scoped: the settings popup only ever views the current user.
 *
 * Usage stats are deliberately not included: the drawer no longer shows them
 * (they live on `/usage`), and `getUserStats` is a 30-day aggregation over
 * `chat_message` that would otherwise run on every open.
 */
export const GET = withAuth(async (_request, _session) => {
  try {
    const currentUserId = await getUserIdAndCheckAccess();
    const [user, accounts] = await Promise.all([getUser(), getUserAccounts()]);

    if (!user) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      currentUserId,
      user,
      userAccountInfo: {
        hasPassword: accounts.hasPassword,
        oauthProviders: accounts.oauthProviders,
      },
    });
  } catch (error) {
    console.error("Failed to load settings context:", error);
    return NextResponse.json(
      { error: "Failed to load settings context" },
      { status: 500 },
    );
  }
});

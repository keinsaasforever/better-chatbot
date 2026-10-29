import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "./server";

/**
 * The resolved Better Auth session, guaranteed present inside a `withAuth`
 * handler. Its shape is `{ session, user }`, so existing handlers keep reading
 * `session.user.id` and `session.session.activeOrganizationId` unchanged.
 */
export type AuthSession = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/**
 * Wrap a route handler so it only runs with a valid session.
 *
 * Resolves the request-cached session, returns the canonical
 * `{ error: "Unauthorized" }` 401 when absent, and injects the session as the
 * handler's second argument. Any Next route context (`{ params }`) is forwarded
 * after it, so per-route param typing is preserved. `getSession` never throws
 * (it returns null on missing/failed sessions), so this also turns the routes
 * that used raw `auth.api.getSession` from a 500 into a 401.
 */
export function withAuth<T extends unknown[]>(
  handler: (
    request: NextRequest,
    session: AuthSession,
    ...args: T
  ) => Response | Promise<Response>,
): (request: NextRequest, ...args: T) => Promise<Response> {
  return async (request, ...args) => {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(request, session, ...args);
  };
}

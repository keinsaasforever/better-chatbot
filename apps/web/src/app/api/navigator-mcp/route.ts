import type { AuthInfo } from "@modelcontextprotocol/server";
import { getSession } from "auth/server";
import { verifyNavigatorApiKey } from "lib/navigator-tools/api-keys";
import { listTools, runTool } from "lib/navigator-tools/registry";
import type { ToolActor } from "lib/navigator-tools/types";
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";

/**
 * The Navigator MCP server: the tool registry over stateless Streamable HTTP.
 *
 * Named `navigator-mcp` because `api/mcp/*` is the MCP *client* CRUD. Every
 * tool runs through `runTool` with an actor built from the credential, never
 * from tool arguments, so MCP callers get exactly the scoping the voice
 * session gets.
 *
 * Two credentials are accepted:
 * - `Authorization: Bearer <Navigator API key>` (Claude Desktop, Cursor, …).
 *   The key's organization is re-checked against membership on every request.
 * - The session cookie, same-origin only, for in-app callers such as the
 *   cockpit's "test connection" button.
 *
 * The cookie redirect in `middleware.ts` skips this path; the missing-
 * credential case is answered here with a 401 challenge.
 */

// A caller waits on run_agent (45 s) and execute_workflow (60 s).
export const maxDuration = 120;

const SERVER_INFO = { name: "keinsaas-navigator", version: "1.0.0" };

function actorOf(authInfo: AuthInfo | undefined): ToolActor | null {
  const actor = authInfo?.extra?.actor as ToolActor | undefined;
  return actor?.userId ? actor : null;
}

const mcpHandler = createMcpHandler(
  (server) => {
    for (const tool of listTools()) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.input,
          annotations: {
            readOnlyHint: tool.readOnly,
            // No tool deletes anything; mutating ones create or change.
            destructiveHint: false,
          },
        },
        async (args: unknown, ctx) => {
          const actor = actorOf(ctx.http?.authInfo);
          if (!actor) {
            return {
              isError: true,
              content: [{ type: "text", text: "Unauthorized" }],
            };
          }
          const result = await runTool(actor, tool.name, args);
          return result.ok
            ? {
                content: [
                  { type: "text", text: JSON.stringify(result.output ?? null) },
                ],
              }
            : {
                isError: true,
                content: [{ type: "text", text: JSON.stringify(result.error) }],
              };
        },
      );
    }
  },
  { serverInfo: SERVER_INFO },
);

/**
 * Cookie auth is a browser path, so it is held to same-origin: a cross-site
 * page must not be able to drive the tools with the visitor's session.
 */
function isSameOriginBrowserRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (origin && origin !== getPublicOrigin(request)) return false;
  return true;
}

type Verified = { authInfo?: AuthInfo; rateLimited?: boolean };

/** One verification per request: verifying a key also counts it against its rate limit. */
const verified = new WeakMap<Request, Verified>();

async function verifyRequest(request: Request): Promise<Verified> {
  const cached = verified.get(request);
  if (cached) return cached;

  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  let outcome: Verified = {};

  if (scheme?.toLowerCase() === "bearer" && token) {
    const result = await verifyNavigatorApiKey(token);
    if (result.ok) {
      outcome = {
        authInfo: {
          token,
          clientId: result.actor.userId,
          scopes: [],
          extra: { actor: result.actor },
        },
      };
    } else if (result.reason === "rate_limited") {
      outcome = { rateLimited: true };
    }
  } else if (!header && isSameOriginBrowserRequest(request)) {
    const session = await getSession();
    if (session?.user?.id) {
      const organizationId =
        (session.session as { activeOrganizationId?: string | null })
          ?.activeOrganizationId ?? null;
      const actor: ToolActor = {
        userId: session.user.id,
        organizationId,
        source: "cockpit",
      };
      outcome = {
        authInfo: {
          token: "session",
          clientId: actor.userId,
          scopes: [],
          extra: { actor },
        },
      };
    }
  }

  verified.set(request, outcome);
  return outcome;
}

const authenticatedHandler = withMcpAuth(
  mcpHandler,
  async (request) => (await verifyRequest(request)).authInfo,
  { required: true },
);

async function handler(request: Request): Promise<Response> {
  if ((await verifyRequest(request)).rateLimited) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Rate limit exceeded" },
        id: null,
      },
      { status: 429, headers: { "Retry-After": "10" } },
    );
  }
  return authenticatedHandler(request);
}

export { handler as DELETE, handler as GET, handler as POST };

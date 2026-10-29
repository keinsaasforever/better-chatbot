import { NextRequest } from "next/server";
import { mcpOAuthRepository, mcpRepository } from "@/lib/db/repository";
import { getMCPClientsManager } from "lib/ai/mcp/mcp-manager";

import globalLogger from "logger";
import { colorize } from "consola/utils";

// Cap the token exchange at 60s so a stalled DB reservation fails fast instead
// of riding the 300s default function timeout.
export const maxDuration = 60;

interface OAuthResponseOptions {
  type: "success" | "error";
  title: string;
  heading: string;
  message: string;
  postMessageType: string;
  postMessageData: Record<string, any>;
  statusCode: number;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createOAuthResponsePage(options: OAuthResponseOptions): Response {
  const {
    type,
    title,
    heading,
    message,
    postMessageType,
    postMessageData,
    statusCode,
  } = options;
  if (type === "success") {
    logger.info("OAuth callback successful", message);
  } else {
    logger.error("OAuth callback failed", message);
  }
  const colorClass = type === "success" ? "success" : "error";
  const color = type === "success" ? "#22c55e" : "#ef4444";
  const postMessage = JSON.stringify({
    type: postMessageType,
    ...postMessageData,
  }).replaceAll("<", "\\u003c");
  const closeScript =
    type === "success" ? "setTimeout(() => window.close(), 1000);" : "";
  const closeMessage =
    type === "success"
      ? "This window will close automatically."
      : "This window will remain open so you can review the error.";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; text-align: center; padding: 2rem; }
    .${colorClass} { color: ${color}; }
  </style>
</head>
<body>
  <script>
    try {
      window.opener?.postMessage(${postMessage}, window.location.origin);
    } catch (e) {
      console.error('Failed to post message:', e);
    }
    ${closeScript}
  </script>
  <div class="${colorClass}">
    <h2>${escapeHtml(heading)}</h2>
    <p>${escapeHtml(message)}</p>
    <p>${closeMessage}</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: statusCode,
    headers: { "Content-Type": "text/html" },
  });
}

const logger = globalLogger.withDefaults({
  message: colorize("bgGreen", `MCP OAuth Callback: `),
});

/**
 * OAuth callback endpoint for MCP servers
 * Handles the authorization code exchange and token storage
 */
export async function GET(request: NextRequest) {
  logger.info("OAuth callback received Authorization Code");
  const { searchParams } = new URL(request.url);

  const callbackData = {
    code: searchParams.get("code") || undefined,
    state: searchParams.get("state") || undefined,
    error: searchParams.get("error") || undefined,
    error_description: searchParams.get("error_description") || undefined,
  };

  // Handle OAuth error responses
  if (callbackData.error) {
    return createOAuthResponsePage({
      type: "error",
      title: "OAuth Error",
      heading: "Authentication Failed",
      message: `Error: ${callbackData.error}. ${callbackData.error_description || "Unknown error occurred"}`,
      postMessageType: "MCP_OAUTH_ERROR",
      postMessageData: {
        error: callbackData.error,
        error_description: callbackData.error_description || "Unknown error",
      },
      statusCode: 400,
    });
  }

  // Validate required parameters
  if (!callbackData.code || !callbackData.state) {
    return createOAuthResponsePage({
      type: "error",
      title: "OAuth Error",
      heading: "Authentication Failed",
      message: "Missing required parameters",
      postMessageType: "MCP_OAUTH_ERROR",
      postMessageData: {
        error: "invalid_request",
        error_description: "Missing authorization code or state parameter",
      },
      statusCode: 400,
    });
  }

  // Find the OAuth session by state
  const session = await mcpOAuthRepository.getSessionByState(
    callbackData.state,
  );
  if (!session) {
    return createOAuthResponsePage({
      type: "error",
      title: "OAuth Error",
      heading: "Authentication Failed",
      message: "Invalid or expired session",
      postMessageType: "MCP_OAUTH_ERROR",
      postMessageData: {
        error: "invalid_state",
        error_description: "Invalid or expired state parameter",
      },
      statusCode: 400,
    });
  }

  try {
    const server = await mcpRepository.selectById(session.mcpServerId);
    if (!server?.userId) {
      throw new Error("MCP server owner not found");
    }

    // The authorization request is created by a user-scoped manager. Resolve
    // the callback through that same scope so a fresh Vercel instance can
    // reconstruct the client from PostgreSQL and adopt the stored PKCE state.
    const userManager = getMCPClientsManager(server.userId);
    const client = await userManager.getClient(session.mcpServerId);
    if (!client) {
      throw new Error("MCP client not found");
    }

    await client.client.ensureOAuthState(callbackData.state);
    await client.client.finishAuth(callbackData.code, callbackData.state);
    await userManager.refreshClient(session.mcpServerId);

    return createOAuthResponsePage({
      type: "success",
      title: "OAuth Success",
      heading: "Authentication Successful!",
      message: "You can now close this window.",
      postMessageType: "MCP_OAUTH_SUCCESS",
      postMessageData: {
        success: true,
      },
      statusCode: 200,
    });
  } catch (error: any) {
    logger.error("OAuth callback failed", error);
    return createOAuthResponsePage({
      type: "error",
      title: "OAuth Error",
      heading: "Authentication Failed",
      message: error.message || "Failed to complete the authentication process",
      postMessageType: "MCP_OAUTH_ERROR",
      postMessageData: {
        error: "auth_failed",
        error_description: "Failed to complete authentication",
      },
      statusCode: 500,
    });
  }
}

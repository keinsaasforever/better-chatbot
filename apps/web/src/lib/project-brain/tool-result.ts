/**
 * Classifies a connector read-action result before it is stored as a project
 * brain source.
 *
 * Composio and MCP tool calls do not throw on failure; they resolve with an
 * error envelope that the AI SDK records as a normal tool result. Without this
 * check a Gmail 403 ends up serialized into the raw source and the extraction
 * step turns "Access blocked, HTTP 403" into project facts and widgets.
 *
 * Shapes covered:
 * - Composio (`@composio/vercel`): `{ successful: false, error: string }`
 * - MCP client / manager:         `{ isError: true, error: { message } }`
 * - MCP server-reported error:    `{ isError: true, content: [{ type: "text", text }] }`
 * - Chat tool loader:             `{ isError: true, error: string }`
 */
export type ToolResultClass =
  | { ok: true }
  | { ok: false; message: string; authLike: boolean };

const AUTH_LIKE =
  /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[_ ]grant|token.*(expired|invalid|revoked)|re-?auth|authori[sz]ation required|not connected|insufficient.*(permission|scope)|access (is )?blocked/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      isRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .filter(Boolean)
    .join(" ");
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }
  return "";
}

export function isAuthLikeMessage(message: string): boolean {
  return AUTH_LIKE.test(message);
}

export function classifyToolResult(output: unknown): ToolResultClass {
  if (!isRecord(output)) return { ok: true };

  let message: string | null = null;

  if (output.successful === false) {
    message = errorMessage(output.error) || "Tool call was not successful.";
  } else if (output.isError === true) {
    message =
      errorMessage(output.error) ||
      contentText(output.content) ||
      "Tool call failed.";
  }

  if (message === null) return { ok: true };

  return { ok: false, message, authLike: isAuthLikeMessage(message) };
}

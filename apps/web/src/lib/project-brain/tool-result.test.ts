import { describe, expect, test } from "vitest";
import { classifyToolResult, isAuthLikeMessage } from "./tool-result";

describe("classifyToolResult", () => {
  test("treats a successful Composio envelope as ok", () => {
    expect(
      classifyToolResult({ successful: true, data: { items: [1] } }),
    ).toEqual({ ok: true });
  });

  test("flags a failed Composio envelope and detects auth problems", () => {
    const result = classifyToolResult({
      successful: false,
      error:
        "Request failed with status code 403: insufficient authentication scopes",
      data: {},
    });

    expect(result).toEqual({
      ok: false,
      message:
        "Request failed with status code 403: insufficient authentication scopes",
      authLike: true,
    });
  });

  test("flags an MCP client error envelope", () => {
    const result = classifyToolResult({
      isError: true,
      error: { message: "Timeout", name: "ERROR" },
      content: [],
    });

    expect(result).toEqual({ ok: false, message: "Timeout", authLike: false });
  });

  test("reads the message from MCP content when no error object is set", () => {
    const result = classifyToolResult({
      isError: true,
      content: [{ type: "text", text: "OAuth user authorization required" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("OAuth user authorization required");
      expect(result.authLike).toBe(true);
    }
  });

  test("leaves plain payloads, strings and arrays untouched", () => {
    expect(classifyToolResult("plain text")).toEqual({ ok: true });
    expect(classifyToolResult([1, 2, 3])).toEqual({ ok: true });
    expect(classifyToolResult({ events: [] })).toEqual({ ok: true });
    expect(classifyToolResult(null)).toEqual({ ok: true });
  });
});

describe("isAuthLikeMessage", () => {
  test("matches the usual credential failures", () => {
    for (const message of [
      "HTTP 401 Unauthorized",
      "Forbidden",
      "invalid_grant",
      "The access token has expired",
      "Please re-authenticate the connection",
      "Insufficient Permission",
    ]) {
      expect(isAuthLikeMessage(message)).toBe(true);
    }
  });

  test("does not match ordinary errors", () => {
    expect(isAuthLikeMessage("Rate limit exceeded")).toBe(false);
    expect(isAuthLikeMessage("Timeout")).toBe(false);
  });
});

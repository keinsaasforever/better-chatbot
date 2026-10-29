import type { z } from "zod";

/**
 * Who is calling a Navigator tool.
 *
 * Always built server-side from an authenticated credential (a session cookie,
 * a Navigator API key, a realtime voice session), never from tool arguments.
 * `organizationId` is the scope every repository read is filtered by: `null`
 * fails closed to the caller's own rows, exactly like `selectAllForUser`.
 */
export type ToolActor = {
  userId: string;
  organizationId: string | null;
  source: "voice" | "mcp" | "cockpit";
};

export type NavigatorToolGroup =
  | "agents"
  | "chat"
  | "projects"
  | "workflows"
  | "scheduled"
  | "skills"
  | "cockpit";

/**
 * The client-safe half of a tool: everything except `run`.
 *
 * Kept separate so the voice drawer (a client component) can list the tools and
 * the prompt builder can describe them without pulling repository code into
 * the browser bundle.
 */
export type NavigatorToolSpec<
  I extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
> = {
  /** snake_case, `/^[a-z0-9_]{1,64}$/`: valid as a Realtime and MCP name. */
  name: string;
  group: NavigatorToolGroup;
  /** One or two sentences, at most 200 characters: re-sent every voice turn. */
  description: string;
  input: I;
  /** False means the tool changes something; voice asks aloud before calling it. */
  readOnly: boolean;
  /** Defaults to true. False keeps the tool off the realtime tool list. */
  voice?: boolean;
};

export type NavigatorTool<
  I extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
> = NavigatorToolSpec<I> & {
  run(actor: ToolActor, args: z.infer<I>): Promise<unknown>;
};

/** Pair a client-safe spec with its server-side `run`, keeping the arg types. */
export function defineTool<I extends z.ZodObject<z.ZodRawShape>>(
  spec: NavigatorToolSpec<I>,
  run: (actor: ToolActor, args: z.infer<I>) => Promise<unknown>,
): NavigatorTool<I> {
  return { ...spec, run };
}

export type ToolErrorCode =
  | "unknown_tool"
  | "invalid_arguments"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "organization_required"
  | "credits_exhausted"
  | "timeout"
  | "unavailable"
  | "tool_execution_failed"
  | (string & {});

export type ToolResult =
  | { ok: true; output: unknown }
  | { ok: false; error: { code: ToolErrorCode; message: string } };

/**
 * An expected, user-facing failure. Its message is returned to the caller
 * verbatim, so it must be safe to read aloud and never carry internals.
 * Anything else a tool throws is logged and answered with a generic message.
 */
export class NavigatorToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NavigatorToolError";
  }
}

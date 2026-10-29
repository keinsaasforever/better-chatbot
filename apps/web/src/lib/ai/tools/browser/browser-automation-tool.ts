import "server-only";
import {
  type LanguageModel,
  type UIMessage,
  tool as createTool,
  readUIMessageStream,
  stepCountIs,
  streamText,
  toUIMessageStream,
} from "ai";
import { aiTelemetry } from "lib/ai/telemetry";
import {
  BROWSER_MAX_STEPS,
  type BrowserToolOutput,
  type KernelBrowserSession,
  UNATTENDED_MAX_RUN_MS,
  toBillableUnits,
} from "lib/kernel/browser-contract";
import { getKernelClient } from "lib/kernel/client";
import {
  buildCredentialCatalog,
  collectSecretValues,
  type ResolvedCredential,
  selectProfile,
} from "lib/kernel/credential-vault";
import { createPlaywrightExecuteTool } from "lib/kernel/playwright-execute-tool";
import { createSecretRedactor } from "lib/kernel/redact-secrets";
import {
  createBrowserSession,
  destroyBrowserSession,
  elapsedSeconds,
} from "lib/kernel/session";
import logger from "logger";
import { z } from "zod";
import {
  BLOCKED_TOOL_ACK,
  BLOCKED_TOOL_NAME,
  readBlockedReason,
} from "./blocked-signal";

/**
 * Rules both modes share.
 *
 * The old instructions told the agent to stop at every sign-in and hand the
 * browser to a watching human. That handoff is gone — an agent signs itself in
 * where it has a credential, and stops where it does not — so the sign-in rule
 * is inverted here rather than merely relaxed.
 */
const SHARED_RULES = `Rules:
- Write Playwright code against the already-open page. Prefer role- and
  text-based locators over brittle CSS selectors.
- Read the page before acting on it. Do not guess at selectors.
- If you land on a sign-in form and a credential is listed below for that site,
  sign in with the placeholders. If no credential is listed, or the page wants
  something no placeholder covers — a one-time code, a CAPTCHA, an app or ID
  approval, a hardware key — do NOT improvise and do NOT look for another way
  in. Call \`${BLOCKED_TOOL_NAME}\` with a short, concrete description of what the
  page is asking for, then write your summary and stop.
- Never invent, guess or brute-force a credential, and never read a password out
  of the task text and type it: the only values you may use are the placeholders
  described below, which you cannot read.
- Only call \`${BLOCKED_TOOL_NAME}\` when a person is genuinely required. If you are
  merely stuck, or the task turns out to be impossible, finish your turn and say
  so plainly.
- The browser solves CAPTCHAs by itself (reCAPTCHA, Cloudflare and similar). If
  you land on one, WAIT for it to clear — poll the page every few seconds rather
  than acting. Never click a Cloudflare checkbox or a "verify you are human"
  control yourself: doing so interferes with the solver and can turn a challenge
  that would have cleared into a hard block. Only treat a challenge as a wall
  once it has plainly failed to clear after a reasonable wait.

Finish with a clear, self-contained summary of what you did and what you found:
concrete values, names and URLs. That summary is the ONLY thing returned to the
main agent, so it must stand alone. If you could not complete the task, say so
plainly and say why.`;

const INTERACTIVE_BROWSER_INSTRUCTIONS = `You are a browser automation agent driving a real
Chrome browser with Playwright. The user is watching the browser live while you
work, so navigate deliberately, one clear step at a time.

${SHARED_RULES}`;

const UNATTENDED_BROWSER_INSTRUCTIONS = `You are a browser automation agent driving a real
Chrome browser with Playwright, on a scheduled run. NOBODY IS WATCHING. There is
no live view open, there is no one to ask, and nothing you write in the page
will reach a person until the run is over. Work efficiently: you have a hard
time limit and a small step budget.

${SHARED_RULES}

Because nobody is present: when you call \`${BLOCKED_TOOL_NAME}\`, the browser is torn
down and the whole scheduled run is recorded as a failure with your reason
attached. That is the correct outcome for a page that needs a person — it is how
the owner finds out. Before you do, include what you can see: the current URL and
the page title, so the failure names where it stopped.`;

export const browserAutomationSchema = z.object({
  task: z
    .string()
    .min(1)
    .describe(
      "What to do in the browser, in plain language. Include the starting URL and what a successful result looks like.",
    ),
  credentialAlias: z
    .string()
    .optional()
    .describe(
      "Which stored sign-in this run is for, when more than one is available. Only selects among the credentials already granted to this run; it cannot reach any other.",
    ),
});

/**
 * Browser automation over a Kernel cloud browser.
 *
 * Follows the subagent pattern of `lib/ai/subagents/research-subagent.ts`: the
 * generator `execute` streams the inner agent's accumulated UIMessage as
 * preliminary results (live progress in the UI), the FINAL yield is a compact
 * object (that is what persists to `chat_message.parts`), and `toModelOutput`
 * hands the main agent only the summary so its context stays lean no matter how
 * many steps the browser run took.
 *
 * The browser is created server-side and never exposed to the client beyond its
 * live-view URL — `KERNEL_API_KEY` must not reach the browser bundle. Resolved
 * credential values never reach the client, the model, or the persisted message:
 * see `lib/kernel/playwright-execute-tool` for where they enter, and
 * `lib/kernel/redact-secrets` for where they are scrubbed on the way out.
 */
export const createBrowserAutomationTool = ({
  model,
  customerId,
  entityId,
  organizationId,
  threadId,
  modelId,
  unattended = false,
  credentials = [],
  onRunBlocked,
  onCredentialUsed,
}: {
  model: LanguageModel;
  customerId?: string;
  entityId?: string;
  organizationId?: string;
  threadId?: string;
  modelId?: string;
  /** No human present: no live view, hard time cap, blocked instead of parked. */
  unattended?: boolean;
  credentials?: ResolvedCredential[];
  /**
   * Called when a run ends because the page needed a person. The chat route
   * folds this into the stream's finish metadata so the scheduled-task runner
   * can record a failure instead of a silent success.
   */
  onRunBlocked?: (block: { source: string; reason: string }) => void;
  onCredentialUsed?: (aliases: string[]) => void;
}) => {
  const catalog = buildCredentialCatalog(credentials);
  const instructions = [
    unattended
      ? UNATTENDED_BROWSER_INSTRUCTIONS
      : INTERACTIVE_BROWSER_INSTRUCTIONS,
    catalog,
  ]
    .filter(Boolean)
    .join("\n\n");
  // Belt and braces to the redaction in playwright-execute-tool: this one
  // covers the terminal strings, which persist and cross into the outer agent.
  const redact = createSecretRedactor(collectSecretValues(credentials));

  return createTool<
    { task: string; credentialAlias?: string },
    BrowserToolOutput,
    Record<string, unknown>
  >({
    description: `Drive a real web browser to complete a task on a website.

Use this when the user asks you to:
- Look something up on a specific site that search cannot reach (a dashboard, a portal, an app behind a login)
- Fill in a form, click through a flow, or check the state of a page
- Read a page that blocks simple fetching

Do NOT use this for ordinary web research — use webSearch, which is far cheaper and faster.
Do NOT use this to fetch a plain public URL — use the http tool.

The browser can sign itself in to sites this workspace has stored a credential
for. Never ask anyone to type a password into the chat.

If a result comes back with status 'blocked', the page needed a person (an
identity check, a one-time code, a CAPTCHA). Calling again will hit the same
wall, so report what it says instead of retrying.`,
    inputSchema: browserAutomationSchema,
    execute: async function* (
      { task, credentialAlias },
      { abortSignal, toolCallId },
    ) {
      // Not optional: the catch below returns, so every later use is reached
      // only when creation succeeded. Typing it `| undefined` made the
      // destructure and the `finally` look unsafe when they are not.
      let session: KernelBrowserSession;

      const profile = selectProfile(credentials, credentialAlias);
      // Only write cookies back when this run could plausibly change auth
      // state. A pure read run must not be able to clobber a good saved
      // session, and Kernel resolves concurrent writers last-write-wins.
      const saveChanges =
        Boolean(profile) &&
        credentials.some(
          (credential) => Object.keys(credential.fields).length > 0,
        );

      try {
        session = await createBrowserSession({
          // On for every run, not just unattended ones. Kernel charges nothing
          // for it, and the CAPTCHA solver it brings is worth most on the
          // portals this tool exists for — a watched run still cannot solve a
          // Cloudflare challenge by itself. Egress is chosen separately (and
          // defaults to direct) so this does not route us into Kernel's
          // managed proxy pool, which blocks government and banking domains.
          stealth: true,
          ...(profile ? { profile: { name: profile.name, saveChanges } } : {}),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not start a browser";
        logger.error("[kernel] browser creation failed", message);
        yield { status: "failed" as const, error: redact(message) };
        return;
      }

      const { sessionId, liveViewUrl } = session;
      yield { status: "starting" as const, sessionId, liveViewUrl };

      let stepCount = 0;
      let summary = "";
      let blockedReason: string | null = null;

      // An unattended run has no one to notice a stuck agent, and the tool's
      // own REST calls keep resetting Kernel's inactivity timer, so the only
      // thing that stops a loop billing headful seconds is this clock.
      const runTimeout = unattended
        ? AbortSignal.timeout(UNATTENDED_MAX_RUN_MS)
        : null;
      const runSignal =
        runTimeout && abortSignal
          ? AbortSignal.any([abortSignal, runTimeout])
          : (runTimeout ?? abortSignal);

      try {
        const result = streamText({
          model,
          system: instructions,
          prompt: task,
          tools: {
            playwright_execute: createPlaywrightExecuteTool({
              client: getKernelClient(),
              sessionId,
              credentials,
              onCredentialUsed,
            }),
            [BLOCKED_TOOL_NAME]: createTool({
              description:
                "Stop because the page needs a person: an identity check, a one-time code, a CAPTCHA, a device approval. The run ends and the reason is reported to whoever owns it.",
              inputSchema: z.object({
                reason: z
                  .string()
                  .min(1)
                  .describe(
                    "What the page is asking for, in one plain sentence, plus the URL you are on. Never include a credential value.",
                  ),
              }),
              execute: async () => BLOCKED_TOOL_ACK,
            }),
          },
          stopWhen: stepCountIs(
            BROWSER_MAX_STEPS[unattended ? "unattended" : "interactive"],
          ),
          abortSignal: runSignal,
          maxRetries: 0,
          experimental_telemetry: aiTelemetry("chat.browser-automation", {
            organizationId,
            threadId,
            modelId,
          }),
        });

        let lastMessage: UIMessage | undefined;
        for await (const message of readUIMessageStream({
          stream: toUIMessageStream({ stream: result.fullStream }),
        })) {
          lastMessage = message;
          yield { status: "running" as const, sessionId, liveViewUrl, message };
        }

        for (const part of lastMessage?.parts ?? []) {
          if (part.type === "text" && part.text.trim()) {
            summary = part.text.trim();
          }
        }
        stepCount =
          lastMessage?.parts.filter((p) => p.type.startsWith("tool-")).length ??
          0;

        blockedReason = readBlockedReason(lastMessage?.parts ?? []);

        if (blockedReason) {
          const reason = redact(blockedReason);
          onRunBlocked?.({ source: "browser-automation", reason });
          yield {
            status: "blocked" as const,
            sessionId,
            liveViewUrl,
            reason,
            summary: redact(summary),
            stepCount,
          };
        } else {
          yield {
            status: "done" as const,
            sessionId,
            liveViewUrl,
            summary:
              redact(summary) || "The browser agent returned no summary.",
            stepCount,
          };
        }

        await trackInnerTokens({
          result,
          customerId,
          entityId,
          modelId,
          sessionId,
          runId: toolCallId,
        });
      } catch (error) {
        const timedOut = runTimeout?.aborted === true;
        const message = timedOut
          ? `The browser run hit its ${Math.round(
              UNATTENDED_MAX_RUN_MS / 1000,
            )}s limit and was stopped.`
          : error instanceof Error
            ? error.message
            : "Browser task failed";
        logger.error(`[kernel] browser run ${sessionId} failed`, message);
        // An unattended run that died mid-task is not a success either, and
        // nothing downstream would notice without this.
        if (unattended) {
          onRunBlocked?.({ source: "browser-automation", reason: message });
        }
        yield { status: "failed" as const, sessionId, error: redact(message) };
      } finally {
        const seconds = elapsedSeconds(session);
        // Every path deletes the browser now that nothing parks: it frees the
        // concurrency slot immediately, and it is also what makes Kernel commit
        // a profile's cookies, which it does only on delete or timeout.
        await destroyBrowserSession(session);
        await trackBrowserRun({
          customerId,
          entityId,
          session,
          seconds,
          threadId,
          runId: toolCallId,
        });
      }
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value:
        output.status === "done"
          ? output.summary
          : output.status === "failed"
            ? `The browser task failed: ${output.error}`
            : output.status === "blocked"
              ? describeBlocked(output)
              : "Browser task in progress.",
    }),
  });
};

/**
 * What the MAIN agent is told when a run stops at something only a person can
 * clear.
 *
 * Spelled out because the expensive mistake is retrying: the wall is the site's
 * identity check, so a second run hits it identically and bills another browser
 * session to learn nothing.
 */
function describeBlocked(
  output: Extract<BrowserToolOutput, { status: "blocked" }>,
): string {
  return [
    `The browser stopped because the page needs a person: ${output.reason}`,
    output.summary
      ? `Progress before it stopped: ${output.summary}`
      : "Nothing was completed before it stopped.",
    "The browser has been closed. Do NOT call this tool again for the same site — the same check will block it. Report this outcome and what it would take to get past it.",
  ].join("\n\n");
}

/**
 * Bill the tokens the inner browser agent burned.
 *
 * The outer chat only ever sees the compact summary via `toModelOutput`, so
 * without this the whole inner run would be free. Never fatal: a metering
 * failure must not turn a successful browser run into a visible error.
 */
/**
 * The slice of `StreamTextResult` this needs.
 *
 * `totalUsage` is a `PromiseLike`, not a `Promise` — it is awaitable but has no
 * `catch`/`finally`. Structural rather than importing `LanguageModelUsage` so
 * this does not break if the AI SDK renames that export.
 */
type UsageBearingResult = {
  totalUsage: PromiseLike<{
    inputTokens?: number;
    outputTokens?: number;
  }>;
};

async function trackInnerTokens(input: {
  result: UsageBearingResult;
  customerId?: string;
  entityId?: string;
  modelId?: string;
  sessionId: string;
  /**
   * The tool call, NOT the browser session. `toolCallId` is minted once per
   * invocation and stable across retries of it — exactly what `billingRunKey`
   * asks for.
   */
  runId: string;
}): Promise<void> {
  const { result, customerId, entityId, modelId, sessionId, runId } = input;
  if (!customerId || !modelId) return;

  try {
    const usage = await result.totalUsage;
    const promptTokens = usage?.inputTokens ?? 0;
    const completionTokens = usage?.outputTokens ?? 0;
    if (promptTokens + completionTokens <= 0) return;

    const { trackUsage } = await import("lib/gate/metering");
    const { billingRunKey } = await import("lib/billing/usage-idempotency");
    await trackUsage({
      kind: "tokens",
      customerId,
      entityId,
      modelId,
      promptTokens,
      completionTokens,
      idempotencyKey: billingRunKey({
        scope: "kernel-agent",
        subject: customerId,
        detail: sessionId,
        runId,
      }),
    });
  } catch (error) {
    logger.error(
      `[kernel] failed to bill agent tokens for ${sessionId}`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Bill one browser run.
 *
 * Reported after the fact, in a `finally`, so a browser that died mid-run is
 * still billed for the time it was alive.
 */
async function trackBrowserRun(input: {
  customerId?: string;
  entityId?: string;
  session: { sessionId: string; browserType: string; startedAt: number };
  seconds: number;
  threadId?: string;
  /** Per tool call — see `trackInnerTokens` for why not the session id. */
  runId: string;
}): Promise<void> {
  const { customerId, entityId, session, seconds, threadId, runId } = input;
  if (!customerId) return;

  const units = toBillableUnits(
    seconds,
    session.browserType as Parameters<typeof toBillableUnits>[1],
  );
  if (units <= 0) return;

  try {
    const { trackUsage } = await import("lib/gate/metering");
    await trackUsage({
      kind: "kernel",
      customerId,
      entityId,
      units,
      seconds,
      browserType: session.browserType,
      sessionId: session.sessionId,
      runId,
      properties: { threadId },
    });
  } catch (error) {
    // Usage consumed but never billed — the under-billing signal. Logged, never
    // surfaced: the browser run itself succeeded.
    logger.error(
      `[kernel] failed to bill browser ${session.sessionId}`,
      error instanceof Error ? error.message : error,
    );
  }
}

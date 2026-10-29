/**
 * Persisting a realtime voice conversation into a chat thread.
 *
 * Client-safe: shapes and caps only, no server imports, so the voice hook and
 * the route agree on the wire format without pulling the DB into the bundle.
 *
 * A voice session used to leave nothing behind. Anything a tool produced that
 * is not speakable — a web search's source links, a document it found — was
 * effectively lost the moment the model finished reading its summary out. It
 * also made "should I create a chat?" a judgement call for the model, which it
 * got wrong in both directions: minting a thread for a passing remark, and
 * dropping a research answer the user wanted to keep. Persisting the whole
 * session removes the decision: the thread always exists.
 */

/** One completed turn of the conversation, as the realtime store had it. */
export type VoiceSessionTurn = {
  /** The realtime message id. Doubles as the chat message id, so re-sending a
   * turn updates it in place rather than duplicating it. */
  id: string;
  role: "user" | "assistant";
  /** `UIMessage["parts"]`, kept opaque here so this file stays dependency-free. */
  parts: unknown[];
};

export type VoiceSessionThreadRequest = {
  /** Thread to write into. The client mints it once per session. */
  threadId: string;
  /** The voice session id, recorded on every message's metadata. */
  voiceSessionId: string;
  /** Names the thread on creation; ignored once the thread exists. */
  title?: string;
  agentId?: string;
  turns: VoiceSessionTurn[];
};

/**
 * Ceiling on one flush. The hook batches completed turns, and a long session
 * that reconnects could otherwise replay everything at once.
 */
export const VOICE_THREAD_MAX_TURNS_PER_FLUSH = 20;

/**
 * Ceiling on the JSON of a single turn's parts.
 *
 * A tool result is the thing that blows this: a web search or a Composio schema
 * fetch runs to tens of kilobytes, and unlike the realtime conversation — which
 * the model eventually drops — a chat message is stored forever and re-read on
 * every thread open. Over the cap the parts are replaced rather than trimmed:
 * half a JSON object renders as nothing useful.
 */
export const VOICE_THREAD_MAX_PART_CHARS = 24_000;

/** How long the hook waits for more turns before flushing what it has. */
export const VOICE_THREAD_FLUSH_DEBOUNCE_MS = 1500;

/** Thread titles are shown in the sidebar; longer ones are cut there anyway. */
export const VOICE_THREAD_TITLE_MAX_CHARS = 80;

/**
 * Returns the parts unchanged when they serialize small enough, and a stand-in
 * describing what was dropped when they do not.
 */
export function capVoiceTurnParts(parts: unknown[]): unknown[] {
  let serialized: string;
  try {
    serialized = JSON.stringify(parts);
  } catch {
    return [{ type: "text", text: "[unreadable voice turn]" }];
  }
  if (serialized.length <= VOICE_THREAD_MAX_PART_CHARS) return parts;

  return parts.map((part) => {
    const typed = part as { type?: unknown };
    if (typed?.type === "text") return part;
    return {
      ...(part as object),
      output: {
        truncated: true,
        note: "Result was too large to keep in the chat history.",
      },
    };
  });
}

/** A message as the voice hook has it, before it becomes a stored turn. */
export type VoiceSessionMessage = {
  id: string;
  role: string;
  parts: unknown[];
  completed: boolean;
};

/**
 * Which completed turns still need writing, and what to remember about them.
 *
 * Returns a signature per turn rather than a plain "sent" flag because a turn
 * is not immutable: `completed` goes true as soon as a text part has any text,
 * so a turn can be persisted mid-stream and grow afterwards. Comparing
 * signatures re-sends the grown turn, and the upsert on the server corrects it
 * in place. The caller debounces, so in practice most turns are only ever sent
 * once.
 *
 * Nothing is written until the user has actually said something. The model
 * greets every session, so opening the drawer and closing it again would
 * otherwise leave a thread behind containing only "Hallo, wie kann ich
 * helfen?" — and the greeting is still kept once there is a conversation to
 * keep it in.
 */
export function selectVoiceTurnsToPersist(
  messages: VoiceSessionMessage[],
  sent: ReadonlyMap<string, string>,
): { turns: VoiceSessionTurn[]; signatures: Map<string, string> } {
  const turns: VoiceSessionTurn[] = [];
  const signatures = new Map<string, string>();

  const userHasSpoken = messages.some(
    (message) =>
      message.completed && message.role === "user" && message.parts.length > 0,
  );
  if (!userHasSpoken) return { turns, signatures };

  for (const message of messages) {
    if (!message.completed) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (!message.parts.length) continue;

    let signature: string;
    try {
      signature = JSON.stringify(message.parts);
    } catch {
      continue;
    }
    if (sent.get(message.id) === signature) continue;

    turns.push({ id: message.id, role: message.role, parts: message.parts });
    signatures.set(message.id, signature);
    if (turns.length >= VOICE_THREAD_MAX_TURNS_PER_FLUSH) break;
  }

  return { turns, signatures };
}

/**
 * The first thing the user said, as a thread title.
 *
 * Falls back to a generic label rather than to the assistant's greeting: the
 * model opens every session the same way, so titling from it would give every
 * voice thread the same name.
 */
export function deriveVoiceThreadTitle(
  turns: VoiceSessionTurn[],
  fallback: string,
): string {
  for (const turn of turns) {
    if (turn.role !== "user") continue;
    const text = turn.parts
      .map((part) => {
        const typed = part as { type?: unknown; text?: unknown };
        return typed?.type === "text" && typeof typed.text === "string"
          ? typed.text
          : "";
      })
      .join(" ")
      .trim();
    if (text) return text.slice(0, VOICE_THREAD_TITLE_MAX_CHARS);
  }
  return fallback;
}

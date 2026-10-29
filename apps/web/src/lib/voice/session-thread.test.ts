import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("lib/db/repository", () => ({
  chatRepository: {
    selectThread: vi.fn(),
    insertThreadWithDefaults: vi.fn(),
    upsertMessage: vi.fn(),
  },
}));

const { chatRepository } = await import("lib/db/repository");
const { persistVoiceSessionTurns } = await import("./session-thread");

const ACTOR = {
  userId: "user-1",
  organizationId: "org-1",
  source: "browser" as const,
};
const THREAD_ID = "11111111-1111-4111-8111-111111111111";

function request(overrides: Record<string, unknown> = {}) {
  return {
    threadId: THREAD_ID,
    voiceSessionId: "session-1",
    turns: [
      {
        id: "msg_1",
        role: "user" as const,
        parts: [{ type: "text", text: "moin" }],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(chatRepository.upsertMessage).mockResolvedValue({} as never);
  vi.mocked(chatRepository.insertThreadWithDefaults).mockResolvedValue(
    {} as never,
  );
});

describe("persistVoiceSessionTurns", () => {
  it("creates the thread on the first flush and titles it from the user's words", async () => {
    vi.mocked(chatRepository.selectThread).mockResolvedValue(null as never);

    const result = await persistVoiceSessionTurns({
      actor: ACTOR,
      request: request(),
      fallbackTitle: "Voice conversation",
    });

    expect(result).toEqual({
      ok: true,
      threadId: THREAD_ID,
      created: true,
      persisted: 1,
    });
    expect(chatRepository.insertThreadWithDefaults).toHaveBeenCalledWith({
      id: THREAD_ID,
      title: "moin",
      userId: "user-1",
      projectId: undefined,
    });
  });

  it("appends to an existing thread without recreating it", async () => {
    vi.mocked(chatRepository.selectThread).mockResolvedValue({
      id: THREAD_ID,
      userId: "user-1",
    } as never);

    const result = await persistVoiceSessionTurns({
      actor: ACTOR,
      request: request(),
      fallbackTitle: "Voice conversation",
    });

    expect(result).toMatchObject({ ok: true, created: false, persisted: 1 });
    expect(chatRepository.insertThreadWithDefaults).not.toHaveBeenCalled();
  });

  /**
   * The thread id comes from the client, so ownership is checked rather than
   * assumed — otherwise any caller could name a thread id and append to
   * someone else's conversation.
   */
  it("refuses a thread owned by someone else", async () => {
    vi.mocked(chatRepository.selectThread).mockResolvedValue({
      id: THREAD_ID,
      userId: "user-2",
    } as never);

    const result = await persistVoiceSessionTurns({
      actor: ACTOR,
      request: request(),
      fallbackTitle: "Voice conversation",
    });

    expect(result).toEqual({ ok: false, code: "forbidden" });
    expect(chatRepository.upsertMessage).not.toHaveBeenCalled();
  });

  /**
   * `chat_message.id` is a global primary key and the upsert rewrites a row's
   * parts without moving its thread, so a realtime id that collided with an
   * existing message would overwrite another conversation's turn.
   */
  it("namespaces message ids by thread and records the voice session", async () => {
    vi.mocked(chatRepository.selectThread).mockResolvedValue(null as never);

    await persistVoiceSessionTurns({
      actor: ACTOR,
      request: request({ agentId: "agent-1" }),
      fallbackTitle: "Voice conversation",
    });

    expect(chatRepository.upsertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `${THREAD_ID}:msg_1`,
        threadId: THREAD_ID,
        role: "user",
        metadata: {
          source: "voice_realtime",
          voiceSessionId: "session-1",
          agentId: "agent-1",
        },
      }),
    );
  });

  it("keeps the rest of the conversation when one turn fails to write", async () => {
    vi.mocked(chatRepository.selectThread).mockResolvedValue(null as never);
    vi.mocked(chatRepository.upsertMessage)
      .mockRejectedValueOnce(new Error("bad parts"))
      .mockResolvedValueOnce({} as never);

    const result = await persistVoiceSessionTurns({
      actor: ACTOR,
      request: request({
        turns: [
          {
            id: "msg_1",
            role: "user",
            parts: [{ type: "text", text: "moin" }],
          },
          {
            id: "msg_2",
            role: "assistant",
            parts: [{ type: "text", text: "hallo" }],
          },
        ],
      }),
      fallbackTitle: "Voice conversation",
    });

    expect(result).toMatchObject({ ok: true, persisted: 1 });
  });
});

import { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  buildImageModelContext,
  extractImageInputs,
  extractLatestUserText,
  toImageInput,
} from "./image-context";

const imageToolResult = (toolCallId: string, url: string): ModelMessage =>
  ({
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName: "image-manager",
        output: {
          type: "json",
          value: {
            images: [{ url, mimeType: "image/png" }],
            model: "Gemini 2.5 Flash Image",
          },
        },
      },
    ],
  }) as ModelMessage;

const imageToolCall = (toolCallId: string): ModelMessage =>
  ({
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId,
        toolName: "image-manager",
        input: { mode: "create" },
      },
    ],
  }) as ModelMessage;

const collectParts = (context: ModelMessage[]) => {
  const parts: { type: string; data?: unknown }[] = [];
  for (const message of context) {
    if (typeof message.content === "string") continue;
    for (const part of message.content) {
      parts.push(part as { type: string; data?: unknown });
    }
  }
  return parts;
};

describe("buildImageModelContext", () => {
  it("emits no orphaned tool calls or tool results after a prior generation", () => {
    // A second generation in the same thread sees the first one's tool call
    // and tool result in history — forwarding either breaks the image model.
    const context = buildImageModelContext([
      { role: "user", content: "draw a cat" },
      imageToolCall("call-1"),
      imageToolResult("call-1", "https://storage.example/cat.png"),
      { role: "user", content: "now make it blue" },
    ]);

    for (const message of context) {
      expect(message.role).not.toBe("tool");
    }
    for (const part of collectParts(context)) {
      expect(part.type).not.toBe("tool-call");
      expect(part.type).not.toBe("tool-result");
    }

    // The generated image is re-attached as a user image so edits still work,
    // in its original position before the follow-up request.
    expect(context).toEqual([
      { role: "user", content: "draw a cat" },
      {
        role: "user",
        content: [
          {
            type: "file",
            mediaType: "image/png",
            data: "https://storage.example/cat.png",
          },
        ],
      },
      { role: "user", content: "now make it blue" },
    ]);
  });

  it("keeps only the most recent generated image and assistant text", () => {
    const context = buildImageModelContext([
      imageToolResult("call-1", "https://storage.example/first.png"),
      {
        role: "assistant",
        content: [{ type: "text", text: "Here is your image." }],
      },
      imageToolResult("call-2", "https://storage.example/second.png"),
      { role: "user", content: "combine them" },
    ]);

    const urls = collectParts(context)
      .filter((part) => part.type === "file")
      .map((part) => part.data);
    expect(urls).toEqual(["https://storage.example/second.png"]);
    expect(context).toContainEqual({
      role: "assistant",
      content: [{ type: "text", text: "Here is your image." }],
    });
  });
});

const userImage = (url: string, text?: string): ModelMessage => ({
  role: "user",
  content: [
    ...(text ? [{ type: "text" as const, text }] : []),
    { type: "file" as const, mediaType: "image/jpeg", data: url },
  ],
});

describe("buildImageModelContext image retention", () => {
  it("keeps a photo uploaded long before the text window", () => {
    const history: ModelMessage[] = [
      userImage("https://storage.example/room.jpg", "here is my living room"),
    ];
    for (let turn = 0; turn < 10; turn++) {
      history.push({ role: "user", content: `tweak ${turn}` });
      history.push({
        role: "assistant",
        content: [{ type: "text", text: `done ${turn}` }],
      });
    }
    history.push({ role: "user", content: "now oak floor" });

    const context = buildImageModelContext(history);
    const urls = collectParts(context)
      .filter((part) => part.type === "file")
      .map((part) => part.data);
    expect(urls).toEqual(["https://storage.example/room.jpg"]);
    // The old photo comes first, its stale caption is dropped, and the
    // latest instruction is still last.
    expect(context[0]).toEqual({
      role: "user",
      content: [
        {
          type: "file",
          mediaType: "image/jpeg",
          data: "https://storage.example/room.jpg",
        },
      ],
    });
    expect(context.at(-1)).toEqual({ role: "user", content: "now oak floor" });
  });

  it("caps uploaded images at the newest four and dedupes repeats", () => {
    const history: ModelMessage[] = [];
    for (let i = 1; i <= 6; i++) {
      history.push(userImage(`https://storage.example/${i}.jpg`));
    }
    history.push(userImage("https://storage.example/6.jpg"));
    history.push({ role: "user", content: "combine" });

    const urls = collectParts(buildImageModelContext(history))
      .filter((part) => part.type === "file")
      .map((part) => part.data);
    expect(urls).toEqual([
      "https://storage.example/3.jpg",
      "https://storage.example/4.jpg",
      "https://storage.example/5.jpg",
      "https://storage.example/6.jpg",
    ]);
  });
});

describe("extractImageInputs / extractLatestUserText", () => {
  it("returns uploads and the last generated image as URLs, oldest first", () => {
    const context = buildImageModelContext([
      userImage("https://storage.example/room.jpg", "my room"),
      imageToolCall("call-1"),
      imageToolResult("call-1", "https://storage.example/gen.png"),
      { role: "user", content: "make the wall green" },
    ]);
    const inputs = extractImageInputs(context);
    // Strings, not URL objects: the SDK's image prompt takes DataContent and
    // treats an http string as a URL for the provider to fetch.
    expect(inputs).toEqual([
      "https://storage.example/room.jpg",
      "https://storage.example/gen.png",
    ]);
    expect(extractLatestUserText(context)).toBe("make the wall green");
  });

  it("only passes through URL-like strings, bytes, and URL objects", () => {
    // A bare string would be decoded as base64 by the SDK, so it is dropped.
    expect(toImageInput("not a url")).toBeUndefined();
    expect(toImageInput(42)).toBeUndefined();
    expect(toImageInput(new URL("https://storage.example/a.png"))).toBe(
      "https://storage.example/a.png",
    );
    expect(toImageInput("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
    const bytes = new Uint8Array([1, 2, 3]);
    expect(toImageInput(bytes)).toBe(bytes);
  });
});

import { describe, expect, it } from "vitest";
import { buildVoiceTokenApiUrl } from "./voice-token-api";

describe("buildVoiceTokenApiUrl", () => {
  it("returns the bare route with no agent", () => {
    expect(buildVoiceTokenApiUrl()).toBe("/api/chat/openai-realtime");
  });

  it("carries the agent id, which the SDK's token POST cannot send in a body", () => {
    expect(buildVoiceTokenApiUrl("agent-1")).toBe(
      "/api/chat/openai-realtime?agentId=agent-1",
    );
  });

  /**
   * The regression this file exists for. Mentions used to be JSON-encoded into
   * this query string, and `buildVoiceToolMentions` emits one mention per tool
   * carrying that tool's full description — so a workspace with ~80 selected
   * tools produced tens of kilobytes of URL and the edge rejected the request
   * with a 414 before it reached the route, logging nothing server-side.
   *
   * The URL is bounded by the agent id, so its length cannot track anything the
   * user selects.
   */
  it("stays short no matter how much tool context the session has", () => {
    const url = buildVoiceTokenApiUrl("11111111-1111-4111-8111-111111111111");
    expect(url.length).toBeLessThan(120);
  });
});

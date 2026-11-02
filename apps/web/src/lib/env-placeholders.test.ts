import { describe, expect, it } from "vitest";
import { clearPlaceholderEnv } from "./env-placeholders";

describe("clearPlaceholderEnv", () => {
  it("unsets optional keys left at the deploy form's placeholder", () => {
    const env: Record<string, string | undefined> = {
      COMPOSIO_API_KEY: "optional",
      TENSORX_API_KEY: " Optional ",
      ASSEMBLYAI_API_KEY: "skip",
      AI_GATEWAY_API_KEY: "required",
    };
    clearPlaceholderEnv(env);
    expect(env).toEqual({});
  });

  it("keeps a real key", () => {
    const env: Record<string, string | undefined> = {
      AI_GATEWAY_API_KEY: "real-key",
    };
    clearPlaceholderEnv(env);
    expect(env).toEqual({ AI_GATEWAY_API_KEY: "real-key" });
  });

  it("never touches other variables", () => {
    const env: Record<string, string | undefined> = {
      BETTER_AUTH_SECRET: "skip",
    };
    clearPlaceholderEnv(env);
    expect(env.BETTER_AUTH_SECRET).toBe("skip");
  });
});

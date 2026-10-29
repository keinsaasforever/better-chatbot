import { afterEach, describe, expect, it, vi } from "vitest";

const MODEL_ERROR = "No model provider is configured";

// IS_VERCEL_ENV is read at import, so every case loads a fresh module.
async function validateWith(env: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  const errors: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args.join(" "));
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  const { validateEnvironment } = await import("./env-validation");
  validateEnvironment();
  return errors.join("\n");
}

const BASE = {
  POSTGRES_URL: "postgres://localhost/db",
  DATABASE_URL: "",
  BETTER_AUTH_SECRET: "secret",
  AI_GATEWAY_API_KEY: "",
  TENSORX_API_KEY: "",
  GROQ_API_KEY: "",
  OLLAMA_BASE_URL: "",
  OPENAI_COMPATIBLE_DATA: "",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("validateEnvironment", () => {
  it("accepts a Vercel deployment without a gateway key (OIDC)", async () => {
    const errors = await validateWith({ ...BASE, VERCEL: "1" });
    expect(errors).not.toContain(MODEL_ERROR);
  });

  it("accepts DATABASE_URL in place of POSTGRES_URL", async () => {
    const errors = await validateWith({
      ...BASE,
      POSTGRES_URL: "",
      DATABASE_URL: "postgres://localhost/db",
      VERCEL: "1",
    });
    expect(errors).toBe("");
  });

  it("requires a model provider when not on Vercel", async () => {
    const errors = await validateWith({ ...BASE, VERCEL: "" });
    expect(errors).toContain(MODEL_ERROR);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

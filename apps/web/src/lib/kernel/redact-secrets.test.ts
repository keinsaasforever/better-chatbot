import { describe, expect, it } from "vitest";
import { createSecretRedactor, redactionToken } from "./redact-secrets";

const TOKEN = redactionToken("emta", "password");

describe("createSecretRedactor", () => {
  it("is identity when there is nothing to redact", () => {
    const redact = createSecretRedactor([]);
    const input = { a: "hunter2" };
    expect(redact(input)).toBe(input);
  });

  it("replaces the value in a plain string", () => {
    const redact = createSecretRedactor([
      { value: "s3cret-pass", token: TOKEN },
    ]);
    expect(redact("login failed for s3cret-pass")).toBe(
      `login failed for ${TOKEN}`,
    );
  });

  it("walks nested objects and arrays", () => {
    const redact = createSecretRedactor([
      { value: "s3cret-pass", token: TOKEN },
    ]);
    expect(
      redact({
        result: { logs: ["value=s3cret-pass", "ok"] },
        count: 2,
      }),
    ).toEqual({
      result: { logs: [`value=${TOKEN}`, "ok"] },
      count: 2,
    });
  });

  // A password that reaches a form can come back in a query string, inside a
  // JSON blob the page rendered, or as a base64 token. Missing one of those is
  // the near-miss that makes a redactor worse than useless.
  it("covers url, json-escaped and base64 encodings", () => {
    const value = 'p@ss "word"/1';
    const redact = createSecretRedactor([{ value, token: TOKEN }]);
    const encoded = encodeURIComponent(value);
    const jsonEscaped = JSON.stringify(value).slice(1, -1);
    const base64 = Buffer.from(value, "utf8").toString("base64");

    const out = redact(`${encoded} | ${jsonEscaped} | ${base64}`);
    expect(out).not.toContain(encoded);
    expect(out).not.toContain(base64);
    expect(out).not.toContain(value);
  });

  it("leaves no fragment when one secret contains another", () => {
    const redact = createSecretRedactor([
      { value: "alice", token: redactionToken("emta", "username") },
      { value: "alice-and-more", token: TOKEN },
    ]);
    expect(redact("alice-and-more")).toBe(TOKEN);
  });

  // Blanking a 3-character value would corrupt unrelated page text everywhere
  // it happens to appear, for no real protection.
  it("skips values too short to match safely", () => {
    const redact = createSecretRedactor([{ value: "abc", token: TOKEN }]);
    expect(redact("abcdef")).toBe("abcdef");
  });

  it("redacts every occurrence, not just the first", () => {
    const redact = createSecretRedactor([
      { value: "s3cret-pass", token: TOKEN },
    ]);
    expect(redact("s3cret-pass and s3cret-pass")).toBe(`${TOKEN} and ${TOKEN}`);
  });

  it("stays correct when the same redactor is reused", () => {
    const redact = createSecretRedactor([
      { value: "s3cret-pass", token: TOKEN },
    ]);
    expect(redact("s3cret-pass")).toBe(TOKEN);
    // A /g regex carries lastIndex between calls; a reset bug shows up here.
    expect(redact("s3cret-pass")).toBe(TOKEN);
  });
});

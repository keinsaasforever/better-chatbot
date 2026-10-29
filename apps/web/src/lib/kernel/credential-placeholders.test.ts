import { describe, expect, it } from "vitest";
import {
  isOriginAllowed,
  type PlaceholderCredential,
  resolveCredentialPlaceholders,
} from "./credential-placeholders";

const EMTA: PlaceholderCredential = {
  alias: "emta",
  domain: "mta.ee",
  allowedUrlPrefix: null,
  fields: { username: "alice@example.com", password: "s3cret-pass" },
};

describe("isOriginAllowed", () => {
  it("accepts the domain and its subdomains", () => {
    expect(isOriginAllowed("https://mta.ee/login", EMTA)).toBe(true);
    expect(isOriginAllowed("https://www.mta.ee/login", EMTA)).toBe(true);
  });

  // The lookalike case is the whole reason this is a suffix-on-a-dot match and
  // not `includes`: anyone can register emta.ee.
  it("rejects a lookalike domain that merely ends in the same letters", () => {
    expect(isOriginAllowed("https://evilmta.ee/login", EMTA)).toBe(false);
    expect(isOriginAllowed("https://mta.ee.evil.com/login", EMTA)).toBe(false);
  });

  it("rejects plain http, so a downgrade cannot put the value on the wire", () => {
    expect(isOriginAllowed("http://mta.ee/login", EMTA)).toBe(false);
  });

  it("rejects an unparseable url", () => {
    expect(isOriginAllowed("not a url", EMTA)).toBe(false);
  });

  it("honours a narrower prefix when one is set", () => {
    const scoped = { ...EMTA, allowedUrlPrefix: "https://mta.ee/tax/" };
    expect(isOriginAllowed("https://mta.ee/tax/vat", scoped)).toBe(true);
    expect(isOriginAllowed("https://mta.ee/other", scoped)).toBe(false);
  });
});

describe("resolveCredentialPlaceholders", () => {
  it("substitutes on the right origin", () => {
    const result = resolveCredentialPlaceholders({
      code: "await page.fill('#p', '{{cred:emta.password}}')",
      credentials: [EMTA],
      pageUrl: "https://mta.ee/login",
    });
    expect(result).toEqual({
      ok: true,
      code: "await page.fill('#p', 's3cret-pass')",
      usedAliases: ["emta"],
    });
  });

  // The injection case: a page the agent read told it to go somewhere else and
  // type the password in. Nothing should come out of the placeholder there.
  it("refuses to substitute on a different origin", () => {
    const result = resolveCredentialPlaceholders({
      code: "await page.fill('#p', '{{cred:emta.password}}')",
      credentials: [EMTA],
      pageUrl: "https://evil.example/login",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("mta.ee");
      expect(result.error).not.toContain("s3cret-pass");
    }
  });

  it("refuses an alias this run was not granted", () => {
    const result = resolveCredentialPlaceholders({
      code: "'{{cred:bank.password}}'",
      credentials: [EMTA],
      pageUrl: "https://mta.ee/login",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses an unknown field", () => {
    const result = resolveCredentialPlaceholders({
      code: "'{{cred:emta.pin}}'",
      credentials: [EMTA],
      pageUrl: "https://mta.ee/login",
    });
    expect(result.ok).toBe(false);
  });

  // Partial substitution would send an unresolved placeholder into a real form
  // field, which is useless and leaks the syntax to the page.
  it("fails the whole snippet when any placeholder is refused", () => {
    const result = resolveCredentialPlaceholders({
      code: "'{{cred:emta.username}}' + '{{cred:emta.pin}}'",
      credentials: [EMTA],
      pageUrl: "https://mta.ee/login",
    });
    expect(result.ok).toBe(false);
  });

  it("leaves code without placeholders untouched", () => {
    const code = "return page.title()";
    const result = resolveCredentialPlaceholders({
      code,
      credentials: [EMTA],
      pageUrl: "https://mta.ee/",
    });
    expect(result).toEqual({ ok: true, code, usedAliases: [] });
  });
});

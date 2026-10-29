import { describe, expect, it } from "vitest";
import { isMcpServerInScope } from "./mcp-server-scope";

const OWNER = "owner-user";
const OTHER = "other-user";
const ORG_A = "org-a";
const ORG_B = "org-b";

describe("isMcpServerInScope", () => {
  it("grants the owner access regardless of org", () => {
    const server = {
      userId: OWNER,
      organizationId: null,
      visibility: "private",
    };
    expect(isMcpServerInScope(server, OWNER, null)).toBe(true);
    expect(isMcpServerInScope(server, OWNER, ORG_A)).toBe(true);
  });

  it("grants same-org non-owner access to a public server", () => {
    const server = {
      userId: OWNER,
      organizationId: ORG_A,
      visibility: "public",
    };
    expect(isMcpServerInScope(server, OTHER, ORG_A)).toBe(true);
  });

  it("denies a second-org non-owner", () => {
    const server = {
      userId: OWNER,
      organizationId: ORG_A,
      visibility: "public",
    };
    expect(isMcpServerInScope(server, OTHER, ORG_B)).toBe(false);
  });

  it("denies when the caller has no active org", () => {
    const server = {
      userId: OWNER,
      organizationId: ORG_A,
      visibility: "public",
    };
    expect(isMcpServerInScope(server, OTHER, null)).toBe(false);
    expect(isMcpServerInScope(server, OTHER, undefined)).toBe(false);
  });

  it("denies an org-less public server to non-owners", () => {
    const server = {
      userId: OWNER,
      organizationId: null,
      visibility: "public",
    };
    expect(isMcpServerInScope(server, OTHER, ORG_A)).toBe(false);
  });

  it("denies a same-org private server to non-owners", () => {
    const server = {
      userId: OWNER,
      organizationId: ORG_A,
      visibility: "private",
    };
    expect(isMcpServerInScope(server, OTHER, ORG_A)).toBe(false);
  });
});

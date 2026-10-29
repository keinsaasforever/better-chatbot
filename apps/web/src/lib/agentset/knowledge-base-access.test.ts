import { describe, expect, it } from "vitest";
import { canAccessKnowledgeBase } from "./knowledge-base-access";

const ORG = "org_1";

describe("canAccessKnowledgeBase", () => {
  it("always allows the owner", () => {
    expect(
      canAccessKnowledgeBase(
        { userId: "u1", organizationId: null, visibility: "private" },
        { userId: "u1", activeOrganizationId: null },
      ),
    ).toBe(true);
  });

  it("allows org members on org-shared public rows", () => {
    expect(
      canAccessKnowledgeBase(
        { userId: "u1", organizationId: ORG, visibility: "public" },
        { userId: "u2", activeOrganizationId: ORG },
      ),
    ).toBe(true);
  });

  it("fails closed without an active org", () => {
    expect(
      canAccessKnowledgeBase(
        { userId: "u1", organizationId: ORG, visibility: "public" },
        { userId: "u2", activeOrganizationId: null },
      ),
    ).toBe(false);
  });

  it("fails closed for a foreign org", () => {
    expect(
      canAccessKnowledgeBase(
        { userId: "u1", organizationId: ORG, visibility: "public" },
        { userId: "u2", activeOrganizationId: "org_2" },
      ),
    ).toBe(false);
  });

  it("never shares private rows regardless of org", () => {
    expect(
      canAccessKnowledgeBase(
        { userId: "u1", organizationId: ORG, visibility: "private" },
        { userId: "u2", activeOrganizationId: ORG },
      ),
    ).toBe(false);
  });

  it("fails closed when the row has no org", () => {
    expect(
      canAccessKnowledgeBase(
        { userId: "u1", organizationId: null, visibility: "public" },
        { userId: "u2", activeOrganizationId: ORG },
      ),
    ).toBe(false);
  });
});

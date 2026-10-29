import { describe, expect, it } from "vitest";
import {
  PROBLEM_REPORT_NOTIFY_TO,
  problemReportEmailBody,
  problemReportEmailSubject,
  type ProblemReportEmailInput,
} from "./notification";

const baseInput: ProblemReportEmailInput = {
  reportId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  description: "Chat stops streaming halfway through a long answer.",
  reporterEmail: "user@example.com",
  reporterName: "Ada Lovelace",
  reporterId: "11111111-2222-3333-4444-555555555555",
  organizationId: "org_42",
  screenshots: [],
  context: {
    pageUrl: "https://app.keinsaas.com/chat/abc",
    locale: "de",
    userAgent: "Mozilla/5.0",
  },
  traceId: "0af7651916cd43dd8448eb211c80319c",
};

describe("problem report notification", () => {
  it("routes to the tech inbox", () => {
    expect(PROBLEM_REPORT_NOTIFY_TO).toBe("tech@keinsaas.com");
  });

  it("puts the report summary and a short id in the subject", () => {
    const subject = problemReportEmailSubject(baseInput);
    expect(subject).toContain("Chat stops streaming halfway");
    expect(subject).toContain("3f2504e0");
  });

  it("carries reporter, context, trace and description in the body", () => {
    const body = problemReportEmailBody(baseInput);
    expect(body).toContain("Ada Lovelace <user@example.com>");
    expect(body).toContain(baseInput.reporterId);
    expect(body).toContain("org_42");
    expect(body).toContain("https://app.keinsaas.com/chat/abc");
    expect(body).toContain("0af7651916cd43dd8448eb211c80319c");
    expect(body).toContain(baseInput.description);
    expect(body).toContain("Screenshots: none");
  });

  it("lists every screenshot with a resolvable link", () => {
    const body = problemReportEmailBody({
      ...baseInput,
      screenshots: [
        {
          key: "user/1-shot.png",
          url: "https://storage.example.com/shot.png",
          name: "shot.png",
          contentType: "image/png",
          size: 1234,
        },
        {
          key: "user/2-second.png",
          url: "https://storage.example.com/second.png",
          name: "second.png",
          contentType: "image/png",
          size: 4321,
        },
      ],
    });
    expect(body).toContain("Screenshots (2):");
    expect(body).toContain("- shot.png: https://storage.example.com/shot.png");
    expect(body).toContain(
      "- second.png: https://storage.example.com/second.png",
    );
  });

  it("falls back to the user id when the account has no email", () => {
    const body = problemReportEmailBody({
      ...baseInput,
      reporterEmail: null,
      reporterName: null,
    });
    expect(body).toContain(`Reporter: ${baseInput.reporterId}`);
  });

  it("omits context lines that were not collected", () => {
    const body = problemReportEmailBody({
      ...baseInput,
      context: null,
      traceId: null,
    });
    expect(body).not.toContain("Page:");
    expect(body).not.toContain("Superlog trace:");
    expect(body).toContain(baseInput.description);
  });
});

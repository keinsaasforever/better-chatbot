import { describe, expect, it } from "vitest";
import {
  incidentTitle,
  PROBLEM_REPORT_EXCEPTION_TYPE,
  problemReportAttributes,
  raiseProblemReportIncident,
} from "./superlog-incident";

describe("incidentTitle", () => {
  it("uses the first line so the incident stays readable", () => {
    expect(incidentTitle("Voice input dies\n\nSteps: open chat, tap mic")).toBe(
      "Voice input dies",
    );
  });

  it("truncates a long single-line report", () => {
    const title = incidentTitle("x".repeat(500));
    expect(title).toHaveLength(120);
    expect(title.endsWith("...")).toBe(true);
  });

  it("falls back to the body when the report starts with blank lines", () => {
    expect(incidentTitle("\n\n  Upload fails  ")).toBe("Upload fails");
  });
});

describe("problemReportAttributes", () => {
  it("groups every report under one stable exception type", () => {
    const attributes = problemReportAttributes({
      reportId: "report-1",
      description: "Something broke",
      screenshotCount: 2,
      organizationId: "org_1",
      context: { pageUrl: "https://app/x", locale: "de" },
    });
    expect(attributes["exception.type"]).toBe(PROBLEM_REPORT_EXCEPTION_TYPE);
    expect(attributes["exception.message"]).toBe("Something broke");
    expect(attributes["problem_report.id"]).toBe("report-1");
    expect(attributes["problem_report.screenshot_count"]).toBe(2);
    expect(attributes["organization.id"]).toBe("org_1");
    expect(attributes["problem_report.page_url"]).toBe("https://app/x");
    expect(attributes["problem_report.locale"]).toBe("de");
  });

  it("attaches no reporter identity", () => {
    const attributes = problemReportAttributes({
      reportId: "report-1",
      description: "Something broke",
      screenshotCount: 0,
    });
    const keys = Object.keys(attributes).join(" ");
    expect(keys).not.toContain("user.id");
    expect(keys).not.toContain("email");
  });

  it("omits context keys that were not collected", () => {
    const attributes = problemReportAttributes({
      reportId: "report-1",
      description: "Something broke",
      screenshotCount: 0,
      organizationId: null,
      context: null,
    });
    expect(attributes).not.toHaveProperty("organization.id");
    expect(attributes).not.toHaveProperty("problem_report.page_url");
    expect(attributes).not.toHaveProperty("thread.id");
  });
});

describe("raiseProblemReportIncident", () => {
  it("returns undefined instead of the no-op tracer's all-zero trace id", () => {
    // No OTel SDK is registered in unit tests, so the global API hands back the
    // no-op tracer — the same situation as local dev without a Superlog token.
    // Storing its zeroed trace id would imply a trace someone could open.
    expect(
      raiseProblemReportIncident({
        reportId: "report-1",
        description: "Something broke",
        screenshotCount: 0,
      }),
    ).toBeUndefined();
  });
});

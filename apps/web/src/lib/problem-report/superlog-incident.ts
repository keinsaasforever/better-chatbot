/**
 * Raises a Superlog incident for a user-submitted problem report.
 *
 * Superlog has no "create incident" API — incidents are grouped from
 * error-severity signals (see `docs/observability.md`). So a report becomes an
 * incident by being emitted the same way a crash is: a span whose status is
 * ERROR carrying a recorded exception, plus an ERROR log record for the
 * signals view. The exception *type* is the constant below rather than the
 * user's text, so every report groups under one issue instead of creating a
 * fresh one per wording, while the message keeps the report readable in the
 * incident itself.
 *
 * ## What is attached
 *
 * The description is user-authored text, and it is attached deliberately: a
 * report with the text stripped is not actionable, and unlike chat content the
 * user wrote it *in order to* send it to us. Identity is not attached — no
 * user id, no email — matching the rule the rest of the telemetry follows.
 * `problem_report.id` links the incident back to the Postgres row, which is
 * where the reporter lives.
 *
 * Never throws: a telemetry failure must not fail the submission that the row
 * and the email already succeeded at.
 */
import { SeverityNumber, logs } from "@opentelemetry/api-logs";
import { SpanStatusCode } from "@opentelemetry/api";
import type { ProblemReportContext } from "app-types/problem-report";
import { appTracer } from "lib/observability/instruments";

/** Stable exception type, so Superlog groups all reports under one issue. */
export const PROBLEM_REPORT_EXCEPTION_TYPE = "UserReportedProblem";

export const PROBLEM_REPORT_SPAN_NAME = "user.problem_report";

export type RaiseProblemReportIncidentInput = {
  reportId: string;
  description: string;
  organizationId?: string | null;
  screenshotCount: number;
  context?: ProblemReportContext | null;
};

/** First line of the report, capped — the incident title has to stay readable. */
export const incidentTitle = (description: string): string => {
  const firstLine = description.trim().split("\n")[0]?.trim() ?? "";
  const source = firstLine.length > 0 ? firstLine : description.trim();
  return source.length > 120 ? `${source.slice(0, 117)}...` : source;
};

/**
 * Span/log attributes for a report. Extracted so the shape is testable without
 * standing up an OTel SDK.
 */
export const problemReportAttributes = (
  input: RaiseProblemReportIncidentInput,
): Record<string, string | number> => {
  const attributes: Record<string, string | number> = {
    "problem_report.id": input.reportId,
    "problem_report.screenshot_count": input.screenshotCount,
    "exception.type": PROBLEM_REPORT_EXCEPTION_TYPE,
    "exception.message": incidentTitle(input.description),
  };
  if (input.organizationId) {
    attributes["organization.id"] = input.organizationId;
  }
  if (input.context?.pageUrl)
    attributes["problem_report.page_url"] = input.context.pageUrl;
  if (input.context?.locale)
    attributes["problem_report.locale"] = input.context.locale;
  if (input.context?.threadId) attributes["thread.id"] = input.context.threadId;
  if (input.context?.userAgent) {
    attributes["user_agent.original"] = input.context.userAgent;
  }
  return attributes;
};

/**
 * Emits the incident signal and returns the trace id it was recorded under, so
 * the caller can store it on the report row. Returns `undefined` when no SDK is
 * registered (local dev without a token), which is not an error.
 */
export function raiseProblemReportIncident(
  input: RaiseProblemReportIncidentInput,
): string | undefined {
  try {
    const attributes = problemReportAttributes(input);
    const title = incidentTitle(input.description);

    return appTracer.startActiveSpan(PROBLEM_REPORT_SPAN_NAME, (span) => {
      try {
        span.setAttributes(attributes);
        // A real Error gives the exporter a stack, which is what Superlog
        // fingerprints on alongside the type.
        const error = new Error(title);
        error.name = PROBLEM_REPORT_EXCEPTION_TYPE;
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: title });

        logs.getLogger("keinsaas-navigator").emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: `User reported a problem: ${title}`,
          attributes: {
            ...attributes,
            "problem_report.description": input.description,
          },
        });

        const traceId = span.spanContext().traceId;
        // The no-op tracer hands back an all-zero id; storing it would imply a
        // trace exists to open.
        return /^0+$/.test(traceId) ? undefined : traceId;
      } finally {
        span.end();
      }
    });
  } catch {
    // Dropping telemetry is bad; failing the report over it is worse.
    return undefined;
  }
}

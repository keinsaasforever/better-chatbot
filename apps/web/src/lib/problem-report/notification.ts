/**
 * The notification mail sent to the tech inbox for every problem report.
 *
 * Pure builders, so the wording and — more importantly — the guarantee that
 * identity, page URL and screenshot links are all present can be asserted in a
 * unit test without an SMTP server.
 */
import type {
  ProblemReportContext,
  ProblemReportScreenshot,
} from "app-types/problem-report";
import { incidentTitle } from "./superlog-incident";

/** Where reports land. Deliberately a constant: this is an internal inbox. */
export const PROBLEM_REPORT_NOTIFY_TO = "tech@keinsaas.com";

export type ProblemReportEmailInput = {
  reportId: string;
  description: string;
  reporterEmail?: string | null;
  reporterName?: string | null;
  reporterId: string;
  organizationId?: string | null;
  screenshots: ProblemReportScreenshot[];
  context?: ProblemReportContext | null;
  traceId?: string | null;
};

export const problemReportEmailSubject = (
  input: ProblemReportEmailInput,
): string =>
  `Problem report: ${incidentTitle(input.description)} [${input.reportId.slice(0, 8)}]`;

export const problemReportEmailBody = (
  input: ProblemReportEmailInput,
): string => {
  const reporter = input.reporterEmail ?? input.reporterId;
  const lines: string[] = [
    `Reporter: ${input.reporterName ? `${input.reporterName} <${reporter}>` : reporter}`,
    `User ID: ${input.reporterId}`,
    `Organization: ${input.organizationId ?? "—"}`,
    `Report ID: ${input.reportId}`,
  ];

  if (input.traceId) lines.push(`Superlog trace: ${input.traceId}`);
  if (input.context?.pageUrl) lines.push(`Page: ${input.context.pageUrl}`);
  if (input.context?.threadId) lines.push(`Thread: ${input.context.threadId}`);
  if (input.context?.locale) lines.push(`Locale: ${input.context.locale}`);
  if (input.context?.viewport)
    lines.push(`Viewport: ${input.context.viewport}`);
  if (input.context?.userAgent)
    lines.push(`User agent: ${input.context.userAgent}`);

  lines.push("", "Description:", input.description, "");

  if (input.screenshots.length > 0) {
    lines.push(`Screenshots (${input.screenshots.length}):`);
    for (const shot of input.screenshots) {
      lines.push(`- ${shot.name}: ${shot.url}`);
    }
  } else {
    lines.push("Screenshots: none");
  }

  return lines.join("\n");
};

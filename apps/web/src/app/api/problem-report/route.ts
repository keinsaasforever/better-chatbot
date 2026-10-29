/**
 * Submissions from the sidebar "Report an issue" dialog.
 *
 * One request fans out to three places, in strict order of how much we care:
 *
 *   1. Postgres — the durable record, and the only step allowed to fail the
 *      request. Everything downstream references its row id.
 *   2. Superlog — an ERROR span/log so the report is grouped into an incident
 *      (`lib/problem-report/superlog-incident.ts` explains why it looks like a
 *      crash rather than an API call). The trace id is written back onto the row.
 *   3. tech@keinsaas.com — a notification mail, awaited so a report is never
 *      acknowledged before the humans have been told.
 *
 * Steps 2 and 3 are best-effort: a Superlog outage or missing SMTP credentials
 * must not lose a bug report that is already stored.
 */
import { ProblemReportInputSchema } from "app-types/problem-report";
import { withAuth } from "auth/route-guard";
import { eq } from "drizzle-orm";
import { pgDb } from "lib/db/pg/db.pg";
import { ProblemReportTable } from "lib/db/pg/schema.pg";
import { problemReportRepository } from "lib/db/repository";
import { sendNotificationEmail } from "lib/gate";
import { flushLogs } from "lib/observability/register";
import {
  PROBLEM_REPORT_NOTIFY_TO,
  problemReportEmailBody,
  problemReportEmailSubject,
} from "lib/problem-report/notification";
import { raiseProblemReportIncident } from "lib/problem-report/superlog-incident";
import globalLogger from "logger";
import { after, NextResponse } from "next/server";

const logger = globalLogger.withDefaults({ message: "ProblemReport: " });

export const POST = withAuth(async (request, session) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ProblemReportInputSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { description, screenshots, context } = parsed.data;
  const organizationId = session.session.activeOrganizationId ?? null;

  let report: Awaited<ReturnType<typeof problemReportRepository.create>>;
  try {
    report = await problemReportRepository.create({
      userId: session.user.id,
      organizationId,
      description,
      screenshots,
      context: context ?? null,
    });
  } catch (error) {
    logger.error("Failed to persist problem report:", error);
    return NextResponse.json(
      { error: "Failed to submit report" },
      { status: 500 },
    );
  }

  const traceId = raiseProblemReportIncident({
    reportId: report.id,
    description,
    organizationId,
    screenshotCount: screenshots.length,
    context,
  });

  if (traceId) {
    try {
      await pgDb
        .update(ProblemReportTable)
        .set({ traceId, updatedAt: new Date() })
        .where(eq(ProblemReportTable.id, report.id));
    } catch (error) {
      logger.warn("Failed to store trace id on problem report:", error);
    }
  }

  const emailInput = {
    reportId: report.id,
    description,
    reporterEmail: session.user.email,
    reporterName: session.user.name,
    reporterId: session.user.id,
    organizationId,
    screenshots,
    context,
    traceId,
  };

  try {
    await sendNotificationEmail({
      to: PROBLEM_REPORT_NOTIFY_TO,
      subject: problemReportEmailSubject(emailInput),
      body: problemReportEmailBody(emailInput),
    });
  } catch (error) {
    // The mail transport already swallows its own failures; this only
    // catches a builder throwing, which must still not lose the stored report.
    logger.warn("Problem report notification email failed:", error);
  }

  logger.info(
    `Report ${report.id} stored (${screenshots.length} screenshot(s), trace ${traceId ?? "none"})`,
  );

  // The incident log record is the most droppable thing in this request: the
  // instance freezes the moment the response body ends.
  after(flushLogs);

  return NextResponse.json({ id: report.id, traceId: traceId ?? null });
});

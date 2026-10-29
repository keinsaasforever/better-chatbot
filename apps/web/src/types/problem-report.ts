import { z } from "zod";

/**
 * A screenshot attached to a problem report.
 *
 * Files are uploaded through `/api/storage/upload` first, so the report only
 * ever carries the storage handle — never base64 in the request body, which
 * would blow past the route body limit on the second screenshot.
 */
export const ProblemReportScreenshotSchema = z.object({
  key: z.string().min(1).max(512),
  url: z.string().url().max(2048),
  name: z.string().min(1).max(255),
  contentType: z.string().min(1).max(128),
  size: z.number().int().nonnegative(),
});

export type ProblemReportScreenshot = z.infer<
  typeof ProblemReportScreenshotSchema
>;

/**
 * Where the user was when the problem happened.
 *
 * Collected by the dialog rather than typed by the user — nobody remembers to
 * include the URL they were on, and it is the first thing anyone triaging the
 * report asks for.
 */
export const ProblemReportContextSchema = z.object({
  pageUrl: z.string().max(2048).optional(),
  userAgent: z.string().max(512).optional(),
  locale: z.string().max(16).optional(),
  viewport: z.string().max(32).optional(),
  /** Chat thread the user was in, when the report was opened from one. */
  threadId: z.string().uuid().optional(),
});

export type ProblemReportContext = z.infer<typeof ProblemReportContextSchema>;

/** Description length the dialog enforces and the route re-checks. */
export const PROBLEM_REPORT_DESCRIPTION_MAX = 5000;
export const PROBLEM_REPORT_MAX_SCREENSHOTS = 5;

export const ProblemReportInputSchema = z.object({
  description: z.string().trim().min(1).max(PROBLEM_REPORT_DESCRIPTION_MAX),
  screenshots: z
    .array(ProblemReportScreenshotSchema)
    .max(PROBLEM_REPORT_MAX_SCREENSHOTS)
    .default([]),
  context: ProblemReportContextSchema.optional(),
});

export type ProblemReportInput = z.infer<typeof ProblemReportInputSchema>;

/**
 * What happened when a turn tried to read one attachment.
 *
 * The ingesters used to swallow every failure and return `null`, which made a
 * production regression indistinguishable from a file nobody supports: both
 * showed up as the model silently knowing nothing about the document. A named
 * status is logged, and a short line goes to the model, so neither the operator
 * nor the user is guessing.
 *
 * `unavailable` deliberately covers *both* "not yours" and "not there". The
 * caller must not be able to tell a foreign object from a missing one — that
 * distinction is an existence oracle over another user's storage. The server
 * records which it was; the model is told neither.
 */

export type IngestStatus =
  | "read"
  | "too_large"
  | "over_budget"
  | "deadline"
  | "unavailable"
  | "unreadable"
  | "unsupported"
  | "disabled";

/** Why an `unavailable` happened. Logged, never returned to a caller. */
export type UnavailableReason = "not_owner" | "not_found" | "bad_url";

export type IngestLogFields = {
  /** Index in the attachment array. The filename is user-supplied; keep it out of logs. */
  index: number;
  format: string | null;
  bytes: number | null;
  durationMs: number;
  status: IngestStatus;
  truncated?: boolean;
  reason?: UnavailableReason;
};

/**
 * The one line an ingest outcome writes.
 *
 * Written here rather than at each call site so the fields cannot drift, and so
 * what is *absent* is enforceable by a test: no filename (user-supplied), no
 * URL (a signed one carries a token), and never any extracted content.
 */
export function formatIngestLog(fields: IngestLogFields): string {
  const pairs: [string, unknown][] = [
    ["format", fields.format ?? "unknown"],
    ["index", fields.index],
    ["status", fields.status],
    ["durationMs", fields.durationMs],
  ];
  if (fields.bytes !== null) pairs.push(["bytes", fields.bytes]);
  if (fields.truncated !== undefined)
    pairs.push(["truncated", fields.truncated]);
  if (fields.reason) pairs.push(["reason", fields.reason]);

  return `[ingest] ${pairs.map(([key, value]) => `${key}=${value}`).join(" ")}`;
}

/**
 * The one line the model gets about a file that was not read.
 *
 * It names the sandbox fallback on purpose: the attachment really is staged in
 * `/home/user` for `python-execution` (see `lib/code-runner/stage-attachments.ts`),
 * so this is an instruction the model can act on rather than an apology. The
 * reason stays coarse — enough to explain, never enough to probe.
 */
export function describeUnreadAttachment(
  filename: string,
  status: Exclude<IngestStatus, "read">,
): string {
  const why: Record<Exclude<IngestStatus, "read">, string> = {
    too_large: "it is larger than the inline reading limit",
    over_budget: "this message already contains as much file content as fits",
    deadline: "reading it took too long",
    unavailable: "it could not be retrieved",
    unreadable: "it could not be parsed",
    unsupported: "this file type is not read inline",
    disabled: "reading this file type is currently switched off",
  };

  return [
    `Attached: ${filename}. Not read inline: ${why[status]}.`,
    status === "unavailable"
      ? "Tell the user the file could not be read and ask them to re-upload it."
      : `It is staged in the sandbox under that name — use python-execution to open it if the user's question needs its contents.`,
  ].join(" ");
}

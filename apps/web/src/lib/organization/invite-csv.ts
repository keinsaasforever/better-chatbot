/**
 * CSV parsing for the bulk invite flow in the organization settings Invite tab.
 *
 * Deliberately pure (no DOM, no Buffer, no DB) so it runs in the client bundle
 * and unit-tests without jsdom, in the style of `invitation-state.ts`.
 *
 * `lib/file-ingest/csv.ts` is not reused: it takes a `node:buffer` Buffer and
 * truncates to a preview. Only its tokenizer loop is forked below.
 */

/**
 * Hard cap on rows imported from one file. Invites are sent one API call at a
 * time and Better Auth applies its default rate limit (100 requests / 60s per
 * IP) while the settings tab is also polling, so the batch has to stay small.
 */
export const MAX_INVITE_CSV_ROWS = 50;

/** Rejected before reading the file, so a mis-picked large file can't hang the tab. */
export const MAX_INVITE_CSV_BYTES = 256 * 1024;

export type InviteCsvRole = "admin" | "member";

export type ParsedInviteRow = {
  /** 1-based line in the source file, so problems are findable in the CSV. */
  lineNumber: number;
  /** Trimmed and lowercased. */
  email: string;
  /** `null` means "inherit the role selected in the form". */
  role: InviteCsvRole | null;
};

export type InviteCsvIssueReason =
  | "invalid-email"
  | "invalid-role"
  | "duplicate-in-file";

export type InviteCsvIssue = {
  lineNumber: number;
  /** The original cell text, for display in the preview. */
  raw: string;
  reason: InviteCsvIssueReason;
};

export type ParsedInviteCsv = {
  rows: ParsedInviteRow[];
  issues: InviteCsvIssue[];
  /** The file held more valid rows than `MAX_INVITE_CSV_ROWS`. */
  truncated: boolean;
};

/**
 * Intentionally permissive. Better Auth validates the address for real when the
 * invitation is created; this only keeps obvious junk out of the preview, so
 * rejecting a deliverable address would be the worse failure. Commas and
 * semicolons are excluded so a mis-delimited file surfaces as invalid rows
 * rather than one cell holding several addresses.
 */
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

const EMAIL_HEADERS = new Set([
  "email",
  "e-mail",
  "email address",
  "e-mail address",
]);

const ROLE_HEADERS = new Set(["role"]);

type RawRow = { cells: string[]; line: number };

const normalize = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase();

/**
 * German-locale Excel writes semicolon-delimited CSV. Without this the whole
 * file parses as a single junk column and every row reads as an invalid email.
 */
function sniffDelimiter(text: string): string {
  const firstLine = text.split("\n").find((line) => line.trim() !== "") ?? "";
  const commas = firstLine.split(",").length - 1;
  const semicolons = firstLine.split(";").length - 1;
  return semicolons > commas ? ";" : ",";
}

/**
 * RFC-4180-ish tokenizer forked from `lib/file-ingest/csv.ts` (handles quotes,
 * `""` escapes and CRLF), extended to record the line each row starts on and to
 * split on a configurable delimiter.
 */
function tokenize(text: string, delimiter: string): RawRow[] {
  const rows: RawRow[] = [];
  let i = 0;
  let field = "";
  let inQuotes = false;
  let cells: string[] = [];
  let line = 1;
  let rowLine = 1;
  let rowStarted = false;

  const pushField = () => {
    cells.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push({ cells, line: rowLine });
    cells = [];
    rowStarted = false;
  };

  while (i < text.length) {
    const ch = text[i++];
    if (!rowStarted) {
      rowLine = line;
      rowStarted = true;
    }

    if (inQuotes) {
      if (ch === '"') {
        if (text[i] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        // A quoted field may span lines; keep the counter honest.
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === "\n") {
      pushField();
      pushRow();
      line++;
    } else if (ch === "\r") {
      // ignore CR (handles CRLF)
    } else {
      field += ch;
    }
  }

  // Flush a trailing row that has no terminating newline.
  pushField();
  if (cells.some((cell) => cell !== "")) pushRow();

  return rows;
}

/**
 * Parse the text of an uploaded CSV into invitable rows plus the problems worth
 * showing the admin before anything is sent.
 *
 * Accepts either a `email,role` header (the `role` column is optional, and blank
 * cells inherit the form's role select) or a bare list of addresses with no
 * header at all.
 */
export function parseInviteCsv(text: string): ParsedInviteCsv {
  const withoutBom = text.replace(/^\uFEFF/, "");
  // Excel sometimes prefixes a delimiter hint line; it is not data.
  const source = withoutBom.replace(/^sep=.*(\r?\n|$)/i, "");

  const rawRows = tokenize(source, sniffDelimiter(source)).filter((row) =>
    row.cells.some((cell) => cell.trim() !== ""),
  );

  if (rawRows.length === 0) {
    return { rows: [], issues: [], truncated: false };
  }

  // A header is detected by name, not position: a data row can never contain a
  // cell that is exactly "email", and an address can never equal it. Matching
  // any cell (not just the first) also handles a `role,email` column order.
  const firstCells = rawRows[0].cells.map(normalize);
  const headerEmailIndex = firstCells.findIndex((cell) =>
    EMAIL_HEADERS.has(cell),
  );
  const hasHeader = headerEmailIndex !== -1;

  const emailIndex = hasHeader ? headerEmailIndex : 0;
  const roleIndex = hasHeader
    ? firstCells.findIndex((cell) => ROLE_HEADERS.has(cell))
    : 1;

  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;

  const accepted: ParsedInviteRow[] = [];
  const issues: InviteCsvIssue[] = [];
  const seen = new Set<string>();

  for (const row of dataRows) {
    const rawEmail = (row.cells[emailIndex] ?? "").trim();
    const email = rawEmail.toLowerCase();

    if (!EMAIL_PATTERN.test(email)) {
      issues.push({
        lineNumber: row.line,
        raw: rawEmail,
        reason: "invalid-email",
      });
      continue;
    }

    const rawRole = roleIndex >= 0 ? (row.cells[roleIndex] ?? "").trim() : "";
    const roleText = rawRole.toLowerCase();
    let role: InviteCsvRole | null = null;
    if (roleText !== "") {
      if (roleText === "admin" || roleText === "member") {
        role = roleText;
      } else {
        // Never silently downgrade an unrecognised role — "owner" in particular
        // is a different operation, not a stronger invitation.
        issues.push({
          lineNumber: row.line,
          raw: rawRole,
          reason: "invalid-role",
        });
        continue;
      }
    }

    if (seen.has(email)) {
      issues.push({
        lineNumber: row.line,
        raw: rawEmail,
        reason: "duplicate-in-file",
      });
      continue;
    }
    seen.add(email);

    accepted.push({ lineNumber: row.line, email, role });
  }

  return {
    rows: accepted.slice(0, MAX_INVITE_CSV_ROWS),
    issues,
    truncated: accepted.length > MAX_INVITE_CSV_ROWS,
  };
}

export type InviteCandidateStatus = "new" | "pending" | "member";

export type InviteCandidate = ParsedInviteRow & {
  status: InviteCandidateStatus;
  /** Set when `status === "pending"`, so the row can be re-sent in place. */
  existingInvitationId?: string;
};

/**
 * Bucket parsed rows against the org's current state.
 *
 * `pending` must be the *live* invitations only — Better Auth leaves expired
 * invitations with status "pending", and treating those as duplicates would
 * silently skip people who need re-inviting.
 */
export function classifyInviteRows(
  rows: ParsedInviteRow[],
  ctx: {
    pending: { id: string; email: string }[];
    memberEmails: (string | null | undefined)[];
  },
): InviteCandidate[] {
  const members = new Set(
    ctx.memberEmails.map(normalize).filter((email) => email !== ""),
  );
  const pendingByEmail = new Map(
    ctx.pending.map((invitation) => [
      normalize(invitation.email),
      invitation.id,
    ]),
  );

  return rows.map((row) => {
    const email = normalize(row.email);

    // Membership wins over a stray pending invitation for the same address.
    if (members.has(email)) return { ...row, status: "member" };

    const existingInvitationId = pendingByEmail.get(email);
    if (existingInvitationId) {
      return { ...row, status: "pending", existingInvitationId };
    }

    return { ...row, status: "new" };
  });
}

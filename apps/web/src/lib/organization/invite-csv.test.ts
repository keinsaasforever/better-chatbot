import { describe, expect, it } from "vitest";
import {
  classifyInviteRows,
  MAX_INVITE_CSV_ROWS,
  parseInviteCsv,
} from "./invite-csv";

describe("parseInviteCsv", () => {
  it("reads an email,role header and treats a blank role as inherited", () => {
    const result = parseInviteCsv(
      "email,role\nanna@acme.com,admin\nben@acme.com,\n",
    );

    expect(result.issues).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.rows).toEqual([
      { lineNumber: 2, email: "anna@acme.com", role: "admin" },
      { lineNumber: 3, email: "ben@acme.com", role: null },
    ]);
  });

  it("accepts a bare list of addresses with no header", () => {
    const result = parseInviteCsv("anna@acme.com\nben@acme.com");

    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([
      { lineNumber: 1, email: "anna@acme.com", role: null },
      { lineNumber: 2, email: "ben@acme.com", role: null },
    ]);
  });

  it("survives CRLF, blank lines and a trailing newline", () => {
    const result = parseInviteCsv(
      "email,role\r\nanna@acme.com,member\r\n\r\nben@acme.com,\r\n",
    );

    expect(result.issues).toEqual([]);
    expect(result.rows.map((row) => row.email)).toEqual([
      "anna@acme.com",
      "ben@acme.com",
    ]);
  });

  it("strips a BOM and matches the header case-insensitively", () => {
    const result = parseInviteCsv("﻿Email,Role\nanna@acme.com,Admin\n");

    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([
      { lineNumber: 2, email: "anna@acme.com", role: "admin" },
    ]);
  });

  it("parses semicolon-delimited files from German Excel", () => {
    const result = parseInviteCsv(
      "sep=;\r\nemail;role\r\nanna@acme.de;Admin\r\nben@acme.de;\r\n",
    );

    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([
      { lineNumber: 2, email: "anna@acme.de", role: "admin" },
      { lineNumber: 3, email: "ben@acme.de", role: null },
    ]);
  });

  it("normalizes surrounding whitespace and casing in addresses", () => {
    const result = parseInviteCsv("email,role\n  Anna@Acme.COM ,  ADMIN \n");

    expect(result.rows).toEqual([
      { lineNumber: 2, email: "anna@acme.com", role: "admin" },
    ]);
  });

  it("keeps a quoted field containing the delimiter intact", () => {
    const result = parseInviteCsv(
      'email,note\nanna@acme.com,"one, two ""quoted"""\n',
    );

    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([
      { lineNumber: 2, email: "anna@acme.com", role: null },
    ]);
  });

  it("reports a malformed address instead of inviting it", () => {
    const result = parseInviteCsv("email,role\nnot-an-email,member\n");

    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([
      { lineNumber: 2, raw: "not-an-email", reason: "invalid-email" },
    ]);
  });

  it("rejects an unknown role rather than downgrading it", () => {
    const result = parseInviteCsv("email,role\nanna@acme.com,owner\n");

    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([
      { lineNumber: 2, raw: "owner", reason: "invalid-role" },
    ]);
  });

  it("flags a repeated address once and invites it once", () => {
    const result = parseInviteCsv(
      "email,role\nanna@acme.com,admin\nANNA@acme.com,member\n",
    );

    expect(result.rows).toEqual([
      { lineNumber: 2, email: "anna@acme.com", role: "admin" },
    ]);
    expect(result.issues).toEqual([
      { lineNumber: 3, raw: "ANNA@acme.com", reason: "duplicate-in-file" },
    ]);
  });

  it("treats a mis-delimited row as invalid rather than one merged address", () => {
    // A comma-delimited file opened as a single column: the whole line lands in
    // one cell, which must not be handed to the invite API.
    const result = parseInviteCsv('email\n"anna@acme.com,ben@acme.com"\n');

    expect(result.rows).toEqual([]);
    expect(result.issues[0]?.reason).toBe("invalid-email");
  });

  it("caps the batch and reports truncation", () => {
    const lines = Array.from(
      { length: MAX_INVITE_CSV_ROWS + 10 },
      (_, i) => `person${i}@acme.com`,
    );
    const result = parseInviteCsv(`email\n${lines.join("\n")}\n`);

    expect(result.rows).toHaveLength(MAX_INVITE_CSV_ROWS);
    expect(result.truncated).toBe(true);
    expect(result.rows.at(-1)?.email).toBe(
      `person${MAX_INVITE_CSV_ROWS - 1}@acme.com`,
    );
  });

  it("returns nothing for an empty file", () => {
    expect(parseInviteCsv("\n\n  \n")).toEqual({
      rows: [],
      issues: [],
      truncated: false,
    });
  });
});

describe("classifyInviteRows", () => {
  const rows = [
    { lineNumber: 1, email: "fresh@acme.com", role: null },
    { lineNumber: 2, email: "invited@acme.com", role: "admin" as const },
    { lineNumber: 3, email: "onboard@acme.com", role: null },
  ];

  it("buckets rows against pending invitations and current members", () => {
    const result = classifyInviteRows(rows, {
      pending: [{ id: "inv-1", email: "Invited@acme.com" }],
      memberEmails: ["ONBOARD@acme.com"],
    });

    expect(result.map((row) => row.status)).toEqual([
      "new",
      "pending",
      "member",
    ]);
    expect(result[1].existingInvitationId).toBe("inv-1");
    expect(result[0].existingInvitationId).toBeUndefined();
  });

  it("prefers membership when an address is both a member and invited", () => {
    const result = classifyInviteRows([rows[1]], {
      pending: [{ id: "inv-1", email: "invited@acme.com" }],
      memberEmails: ["invited@acme.com"],
    });

    expect(result[0].status).toBe("member");
  });

  it("ignores members with no email on record", () => {
    const result = classifyInviteRows([rows[0]], {
      pending: [],
      memberEmails: [null, undefined, ""],
    });

    expect(result[0].status).toBe("new");
  });
});

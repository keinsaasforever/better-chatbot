import { describe, it, expect } from "vitest";
import { formatCsvPreviewText, parseCsvPreview } from "./csv";

describe("parseCsvPreview", () => {
  it("parses simple CSV and limits rows/cols", () => {
    const csv = "a,b,c\n1,2,3\n4,5,6\n7,8,9\n";
    const res = parseCsvPreview(Buffer.from(csv), { maxRows: 2, maxCols: 2 });
    expect(res.header).toEqual(["a", "b"]);
    expect(res.rows).toEqual([
      ["1", "2"],
      ["4", "5"],
    ]);
    expect(res.columns).toBe(2);
    expect(res.totalRows).toBe(4); // includes header
    expect(res.markdownTable).toContain("| a | b |");
  });

  it("handles quoted fields and escaped quotes", () => {
    const csv = 'name,desc\n"ACME, Inc.","He said ""hello"""\n';
    const res = parseCsvPreview(Buffer.from(csv));
    expect(res.header).toEqual(["name", "desc"]);
    expect(res.rows[0]).toEqual(["ACME, Inc.", 'He said "hello"']);
  });

  it("formats preview text with summary metadata", () => {
    const csv = "col1,col2\n1,2\n3,4\n";
    const preview = parseCsvPreview(Buffer.from(csv));
    const text = formatCsvPreviewText("sample.csv", preview);
    expect(text).toContain("sample.csv");
    expect(text).toContain("rows: 3");
    expect(text).toContain("cols: 2");
    expect(text).toContain("| col1 | col2 |");
  });

  it("handles CRLF the same as LF", () => {
    const res = parseCsvPreview(Buffer.from("a,b\r\n1,2\r\n"));
    expect(res.header).toEqual(["a", "b"]);
    expect(res.rows).toEqual([["1", "2"]]);
    expect(res.totalRows).toBe(2);
  });

  it("counts the last row when the file does not end on a newline", () => {
    const res = parseCsvPreview(Buffer.from("a,b\n1,2"));
    expect(res.totalRows).toBe(2);
    expect(res.rows).toEqual([["1", "2"]]);
  });

  it("treats a newline inside quotes as content, not a row break", () => {
    const res = parseCsvPreview(Buffer.from('a,b\n"line one\nline two",2\n'));
    expect(res.totalRows).toBe(2);
    expect(res.rows[0]).toEqual(["line one\nline two", "2"]);
  });

  describe("bounded memory", () => {
    it("counts every row while storing only the preview", () => {
      const csv = `a,b\n${Array.from({ length: 500 }, (_, i) => `${i},x`).join("\n")}\n`;
      const res = parseCsvPreview(Buffer.from(csv), { maxRows: 5 });

      expect(res.rows).toHaveLength(5);
      // The scan runs to the end even though it stopped storing rows.
      expect(res.totalRows).toBe(501);
      expect(res.truncated).toBe(true);
    });

    it("keeps the quoting state after it stops storing rows", () => {
      // Rows 1-3 fill the preview; the quoted field afterwards holds commas
      // and a newline that must not be read as separators.
      const csv = 'a,b\n1,2\n3,4\n"x,y\nz",6\n';
      const res = parseCsvPreview(Buffer.from(csv), { maxRows: 2 });

      expect(res.rows).toHaveLength(2);
      // Four rows, not five: the quoted newline is content.
      expect(res.totalRows).toBe(4);
    });

    it("clips a single enormous cell rather than making it the whole preview", () => {
      const csv = `a,b\n${"z".repeat(5000)},2\n`;
      const res = parseCsvPreview(Buffer.from(csv), { maxCellChars: 100 });

      expect(res.rows[0][0]).toHaveLength(101); // 100 kept plus the ellipsis
      expect(res.rows[0][1]).toBe("2");
      expect(res.truncated).toBe(true);
    });
  });

  it("reports bytes that were not valid UTF-8", () => {
    const res = parseCsvPreview(
      Buffer.concat([
        Buffer.from("a,b\n"),
        Buffer.from([0xff]),
        Buffer.from(",2\n"),
      ]),
    );

    expect(res.replacedInvalidBytes).toBe(true);
    expect(formatCsvPreviewText("x.csv", res)).toMatch(/not valid UTF-8/i);
  });

  it("previews a semicolon-delimited export as one column", () => {
    // A documented limitation rather than a silent misparse: German-locale
    // Excel writes these, and delimiter sniffing is a tracked follow-up.
    const res = parseCsvPreview(Buffer.from("a;b\n1;2\n"));
    expect(res.header).toEqual(["a;b"]);
    expect(res.columns).toBe(1);
  });
});

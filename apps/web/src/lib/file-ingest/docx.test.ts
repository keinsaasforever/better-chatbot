import { Buffer } from "node:buffer";
import JSZip from "jszip";
import { describe, expect, test } from "vitest";
import { formatDocxPreviewText, parseDocxPreview } from "./docx";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PKG_RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_DOC =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

/**
 * A real .docx, written by hand rather than checked in.
 *
 * No Word writer is installed, so the alternative would be a canned binary
 * whose provenance the test cannot state. This proves the installed mammoth
 * against the file format, which is the part that could break under an
 * upgrade.
 */
async function docxFile(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="${PKG_RELS}">
  <Relationship Id="rId1" Type="${OFFICE_DOC}" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${W}">
  <w:body>
${paragraphs
  .map(
    (text) =>
      `    <w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`,
  )
  .join("\n")}
  </w:body>
</w:document>`,
  );
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

describe("parseDocxPreview", () => {
  test("reads the paragraphs as lines", async () => {
    const buffer = await docxFile([
      "Kündigungsfrist: 3 Monate",
      "Gerichtsstand: Zürich",
    ]);

    const preview = await parseDocxPreview(buffer);

    expect(preview.text).toContain("Kündigungsfrist: 3 Monate");
    expect(preview.text).toContain("Gerichtsstand: Zürich");
    expect(preview.truncated).toBe(false);
  });

  test("collapses the runs of empty paragraphs Word leaves behind", async () => {
    const buffer = await docxFile(["First", "", "", "", "Second"]);

    const preview = await parseDocxPreview(buffer);

    expect(preview.text).not.toMatch(/\n{3,}/);
    expect(preview.text).toContain("First");
    expect(preview.text).toContain("Second");
  });

  test("truncates to the caller's budget and says so", async () => {
    const buffer = await docxFile(["x".repeat(500)]);

    const preview = await parseDocxPreview(buffer, { maxChars: 100 });

    expect(preview.text).toHaveLength(100);
    expect(preview.truncated).toBe(true);
  });

  test("rejects a file that is not a document", async () => {
    await expect(
      parseDocxPreview(Buffer.from("this is not a docx")),
    ).rejects.toThrow();
  });
});

describe("formatDocxPreviewText", () => {
  test("points at the sandbox when it had to cut the text", () => {
    const text = formatDocxPreviewText("contract.docx", {
      text: "Kündigungsfrist",
      truncated: true,
    });

    expect(text).toContain("contract.docx");
    expect(text).toMatch(/truncated/i);
    expect(text).toMatch(/python-execution/);
  });

  test("says nothing extra when the whole document fits", () => {
    const text = formatDocxPreviewText("contract.docx", {
      text: "Kündigungsfrist",
      truncated: false,
    });

    expect(text).not.toMatch(/truncated/i);
    expect(text).toContain("Kündigungsfrist");
  });
});

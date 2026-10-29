import { Buffer } from "node:buffer";
import JSZip from "jszip";
import { describe, expect, test } from "vitest";
import { MAX_ZIP_ENTRIES, OoxmlError } from "./ooxml";
import { formatPptxPreviewText, parsePptxPreview } from "./pptx";

/**
 * Fixtures are built here with jszip rather than checked in as binaries.
 *
 * No pptx writer is installed, so a canned file would have to come from
 * somewhere else and would encode whatever assumptions its author had. Writing
 * the XML by hand states the assumption in the test, and lets the hostile cases
 * — a compression bomb, a DOCTYPE, ten thousand entries — be expressed at all.
 */
async function pptxFile(parts: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(parts)) zip.file(path, content);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

const PRESENTATION = (ids: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://ppt" xmlns:r="http://rel">
  <p:sldIdLst>
${ids.map((id, i) => `    <p:sldId id="${256 + i}" r:id="${id}"/>`).join("\n")}
  </p:sldIdLst>
</p:presentation>`;

const RELS = (
  entries: Array<{ id: string; target: string; external?: boolean }>,
) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://rels">
${entries
  .map(
    (entry) =>
      `  <Relationship Id="${entry.id}" Type="http://slide" Target="${entry.target}"${
        entry.external ? ' TargetMode="External"' : ""
      }/>`,
  )
  .join("\n")}
</Relationships>`;

/** A slide with a title placeholder and body paragraphs. */
const SLIDE = (title: string, body: string[], attributes = "") =>
  `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://ppt" xmlns:a="http://draw"${attributes ? ` ${attributes}` : ""}>
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:txBody>
${body.map((line) => `          <a:p><a:r><a:t>${line}</a:t></a:r></a:p>`).join("\n")}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

const deck = (slides: Record<string, string>, relIds?: string[]) => {
  const ids = relIds ?? Object.keys(slides).map((_, i) => `rId${i + 1}`);
  return {
    "ppt/presentation.xml": PRESENTATION(ids),
    "ppt/_rels/presentation.xml.rels": RELS(
      ids.map((id, i) => ({ id, target: Object.keys(slides)[i] ?? "" })),
    ),
    ...Object.fromEntries(
      Object.entries(slides).map(([name, xml]) => [`ppt/${name}`, xml]),
    ),
  };
};

describe("parsePptxPreview", () => {
  test("reads titles and body text, slide by slide", async () => {
    const buffer = await pptxFile(
      deck({
        "slides/slide1.xml": SLIDE("Q1 Results", [
          "Revenue up 12%",
          "EMEA led",
        ]),
        "slides/slide2.xml": SLIDE("Outlook", ["Hiring two engineers"]),
      }),
    );

    const preview = await parsePptxPreview(buffer);

    expect(preview.totalSlides).toBe(2);
    expect(preview.skipped).toBe(0);
    expect(preview.partial).toBe(true);
    expect(preview.slides[0]).toMatchObject({
      index: 1,
      title: "Q1 Results",
      hidden: false,
    });
    expect(preview.slides[0].text).toContain("Revenue up 12%");
    expect(preview.slides[1].title).toBe("Outlook");
  });

  test("follows the presentation's order, not the file names", async () => {
    // slide2 is listed first. Sorting the zip entries would get this backwards,
    // and would also put slide10 before slide2.
    const buffer = await pptxFile({
      "ppt/presentation.xml": PRESENTATION(["rId2", "rId1"]),
      "ppt/_rels/presentation.xml.rels": RELS([
        { id: "rId1", target: "slides/slide1.xml" },
        { id: "rId2", target: "slides/slide2.xml" },
      ]),
      "ppt/slides/slide1.xml": SLIDE("First file", []),
      "ppt/slides/slide2.xml": SLIDE("First slide", []),
    });

    const preview = await parsePptxPreview(buffer);

    expect(preview.slides.map((slide) => slide.title)).toEqual([
      "First slide",
      "First file",
    ]);
  });

  test("does not depend on the conventional namespace prefixes", async () => {
    // `p:` and `a:` are bound to namespaces in the document, not required by
    // it: a writer may pick any letters.
    const buffer = await pptxFile({
      "ppt/presentation.xml": `<?xml version="1.0"?>
<x:presentation xmlns:x="http://ppt" xmlns:q="http://rel">
  <x:sldIdLst><x:sldId id="256" q:id="rId1"/></x:sldIdLst>
</x:presentation>`,
      "ppt/_rels/presentation.xml.rels": RELS([
        { id: "rId1", target: "slides/slide1.xml" },
      ]),
      "ppt/slides/slide1.xml": `<?xml version="1.0"?>
<y:sld xmlns:y="http://ppt" xmlns:z="http://draw">
  <y:cSld><y:spTree><y:sp>
    <y:nvSpPr><y:nvPr><y:ph type="ctrTitle"/></y:nvPr></y:nvSpPr>
    <y:txBody><z:p><z:r><z:t>Odd prefixes</z:t></z:r></z:p></y:txBody>
  </y:sp></y:spTree></y:cSld>
</y:sld>`,
    });

    const preview = await parsePptxPreview(buffer);

    expect(preview.slides[0].title).toBe("Odd prefixes");
  });

  describe("relationships", () => {
    test("resolves a target relative to the referencing part", async () => {
      const buffer = await pptxFile(
        deck({ "slides/slide1.xml": SLIDE("Relative", []) }),
      );
      const preview = await parsePptxPreview(buffer);
      expect(preview.slides[0].title).toBe("Relative");
    });

    test("resolves an absolute target and one that walks up", async () => {
      const buffer = await pptxFile({
        "ppt/presentation.xml": PRESENTATION(["rId1", "rId2"]),
        "ppt/_rels/presentation.xml.rels": RELS([
          { id: "rId1", target: "/ppt/slides/slide1.xml" },
          { id: "rId2", target: "../ppt/slides/slide2.xml" },
        ]),
        "ppt/slides/slide1.xml": SLIDE("Absolute", []),
        "ppt/slides/slide2.xml": SLIDE("Upwards", []),
      });

      const preview = await parsePptxPreview(buffer);

      expect(preview.slides.map((slide) => slide.title)).toEqual([
        "Absolute",
        "Upwards",
      ]);
    });

    test("never follows an external relationship", async () => {
      const buffer = await pptxFile({
        "ppt/presentation.xml": PRESENTATION(["rId1"]),
        "ppt/_rels/presentation.xml.rels": RELS([
          {
            id: "rId1",
            target: "https://attacker.test/slide.xml",
            external: true,
          },
        ]),
      });

      const preview = await parsePptxPreview(buffer);

      // Not "skipped": the relationship was never a slide in this package.
      expect(preview.totalSlides).toBe(0);
      expect(preview.slides).toEqual([]);
    });

    test("takes the first of two relationships claiming one id", async () => {
      const buffer = await pptxFile({
        "ppt/presentation.xml": PRESENTATION(["rId1"]),
        "ppt/_rels/presentation.xml.rels": RELS([
          { id: "rId1", target: "slides/slide1.xml" },
          { id: "rId1", target: "slides/slide2.xml" },
        ]),
        "ppt/slides/slide1.xml": SLIDE("Legitimate", []),
        "ppt/slides/slide2.xml": SLIDE("Shadow", []),
      });

      const preview = await parsePptxPreview(buffer);

      expect(preview.slides[0].title).toBe("Legitimate");
    });

    test("counts a slide whose part is missing rather than losing the deck", async () => {
      const buffer = await pptxFile({
        "ppt/presentation.xml": PRESENTATION(["rId1", "rId2"]),
        "ppt/_rels/presentation.xml.rels": RELS([
          { id: "rId1", target: "slides/slide1.xml" },
          { id: "rId2", target: "slides/gone.xml" },
        ]),
        "ppt/slides/slide1.xml": SLIDE("Here", []),
      });

      const preview = await parsePptxPreview(buffer);

      expect(preview.totalSlides).toBe(2);
      expect(preview.slides).toHaveLength(1);
      expect(preview.skipped).toBe(1);
    });
  });

  describe("content", () => {
    test("includes a hidden slide and says that it is hidden", async () => {
      const buffer = await pptxFile(
        deck({
          "slides/slide1.xml": SLIDE("Backup numbers", ["Detail"], 'show="0"'),
        }),
      );

      const preview = await parsePptxPreview(buffer);

      // The content is in the file; skipping it during a show is a display
      // choice, not a statement that it does not exist.
      expect(preview.slides[0].hidden).toBe(true);
      expect(preview.slides[0].text).toContain("Detail");
    });

    test("reads table cells and grouped shapes", async () => {
      const buffer = await pptxFile({
        "ppt/presentation.xml": PRESENTATION(["rId1"]),
        "ppt/_rels/presentation.xml.rels": RELS([
          { id: "rId1", target: "slides/slide1.xml" },
        ]),
        "ppt/slides/slide1.xml": `<?xml version="1.0"?>
<p:sld xmlns:p="http://ppt" xmlns:a="http://draw">
  <p:cSld><p:spTree>
    <p:grpSp><p:sp><p:txBody><a:p><a:r><a:t>Inside a group</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp>
    <p:graphicFrame><a:graphic><a:graphicData><a:tbl>
      <a:tr><a:tc><a:txBody><a:p><a:r><a:t>Cell one</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
    </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
  </p:spTree></p:cSld>
</p:sld>`,
      });

      const preview = await parsePptxPreview(buffer);

      expect(preview.slides[0].text).toContain("Inside a group");
      expect(preview.slides[0].text).toContain("Cell one");
    });

    test("takes one branch of AlternateContent, not both", async () => {
      const buffer = await pptxFile({
        "ppt/presentation.xml": PRESENTATION(["rId1"]),
        "ppt/_rels/presentation.xml.rels": RELS([
          { id: "rId1", target: "slides/slide1.xml" },
        ]),
        "ppt/slides/slide1.xml": `<?xml version="1.0"?>
<p:sld xmlns:p="http://ppt" xmlns:a="http://draw" xmlns:mc="http://mc">
  <p:cSld><p:spTree>
    <mc:AlternateContent>
      <mc:Choice Requires="v14"><p:sp><p:txBody><a:p><a:r><a:t>Same text</a:t></a:r></a:p></p:txBody></p:sp></mc:Choice>
      <mc:Fallback><p:sp><p:txBody><a:p><a:r><a:t>Same text</a:t></a:r></a:p></p:txBody></p:sp></mc:Fallback>
    </mc:AlternateContent>
  </p:spTree></p:cSld>
</p:sld>`,
      });

      const preview = await parsePptxPreview(buffer);

      // Two renderings of one thing: counting both would duplicate the deck.
      expect(preview.slides[0].text).toBe("Same text");
    });

    test("expands the built-in entities and keeps preserved spaces", async () => {
      const buffer = await pptxFile({
        "ppt/presentation.xml": PRESENTATION(["rId1"]),
        "ppt/_rels/presentation.xml.rels": RELS([
          { id: "rId1", target: "slides/slide1.xml" },
        ]),
        "ppt/slides/slide1.xml": `<?xml version="1.0"?>
<p:sld xmlns:p="http://ppt" xmlns:a="http://draw">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t xml:space="preserve">Bar &amp;</a:t></a:r><a:r><a:t xml:space="preserve"> Grill</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`,
      });

      const preview = await parsePptxPreview(buffer);

      // Runs are concatenated, so a space at a run boundary is the only thing
      // keeping the words apart.
      expect(preview.slides[0].text).toBe("Bar & Grill");
    });
  });

  describe("hostile input", () => {
    test("refuses a part that declares a DOCTYPE", async () => {
      const buffer = await pptxFile({
        "ppt/presentation.xml": `<?xml version="1.0"?>
<!DOCTYPE p:presentation [ <!ENTITY boom "boomboomboom"> ]>
<p:presentation xmlns:p="http://ppt"><p:sldIdLst/></p:presentation>`,
      });

      // No legitimate OOXML part has one, so refusing the declaration
      // forecloses entity expansion without bounding it.
      await expect(parsePptxPreview(buffer)).rejects.toThrow(OoxmlError);
    });

    test("refuses an archive with too many entries", async () => {
      const zip = new JSZip();
      for (let i = 0; i < MAX_ZIP_ENTRIES + 1; i += 1)
        zip.file(`f${i}.xml`, "x");
      const buffer = Buffer.from(
        await zip.generateAsync({ type: "nodebuffer" }),
      );

      await expect(parsePptxPreview(buffer)).rejects.toMatchObject({
        reason: "too_many_entries",
      });
    });

    test("refuses an entry that inflates past the cap", async () => {
      // A compression bomb in miniature: 21 MB of one byte is a few KB on
      // disk, and inflating it costs the instance every live request shares.
      const zip = new JSZip();
      zip.file("ppt/presentation.xml", "a".repeat(21 * 1024 * 1024));
      const buffer = Buffer.from(
        await zip.generateAsync({ type: "nodebuffer" }),
      );

      await expect(parsePptxPreview(buffer)).rejects.toMatchObject({
        reason: "entry_too_large",
      });
    });

    test("refuses something that is not an archive at all", async () => {
      await expect(
        parsePptxPreview(Buffer.from("this is not a zip")),
      ).rejects.toMatchObject({ reason: "not_a_zip" });
    });

    test("reads only the parts it names, whatever else is in the archive", async () => {
      const buffer = await pptxFile({
        ...deck({ "slides/slide1.xml": SLIDE("Fine", []) }),
        "ppt/media/image1.png": "not really a png",
        "ppt/embeddings/book.xlsx": "not really a workbook",
      });

      const preview = await parsePptxPreview(buffer);

      // Media and embedded objects are the bulk of a real deck's bytes and
      // none of it is text.
      expect(preview.slides[0].title).toBe("Fine");
      expect(preview.slides[0].text).not.toContain("not really");
    });
  });

  test("caps how many slides it reads", async () => {
    const slides: Record<string, string> = {};
    for (let i = 1; i <= 5; i += 1) {
      slides[`slides/slide${i}.xml`] = SLIDE(`Slide ${i}`, []);
    }
    const buffer = await pptxFile(deck(slides));

    const preview = await parsePptxPreview(buffer, { maxSlides: 2 });

    expect(preview.totalSlides).toBe(5);
    expect(preview.slides).toHaveLength(2);
    expect(preview.truncated).toBe(true);
  });
});

describe("formatPptxPreviewText", () => {
  test("says what it did not read", async () => {
    const text = formatPptxPreviewText("deck.pptx", {
      slides: [{ index: 1, title: "Q1", text: "Revenue up", hidden: true }],
      totalSlides: 3,
      skipped: 1,
      truncated: true,
      partial: true,
    });

    expect(text).toContain("deck.pptx");
    expect(text).toContain("### Slide 1: Q1 (hidden)");
    expect(text).toContain("Revenue up");
    expect(text).toMatch(/charts, SmartArt/i);
    expect(text).toMatch(/1 slide\(s\) could not be read/);
    expect(text).toMatch(/python-execution/);
  });
});

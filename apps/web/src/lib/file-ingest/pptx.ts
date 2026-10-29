import type { Buffer } from "node:buffer";
import { OoxmlError, OoxmlPackage, resolveRelTarget } from "./ooxml";

/**
 * The text of a .pptx, slide by slide.
 *
 * Text-first and it says so. A deck's charts, SmartArt, embedded workbooks and
 * speaker notes are not read: each is a different part format, and reading a
 * chart's XML well enough to describe it is a project of its own. The preview
 * is marked `partial` so the model offers the sandbox for the rest rather than
 * asserting the deck says nothing about them.
 *
 * Slide *order* comes from `p:sldIdLst` in `ppt/presentation.xml`, resolved
 * through the relationship file — not from sorting `slide1.xml`, `slide2.xml`,
 * which is the file layout rather than the presentation, disagrees whenever
 * slides have been reordered, and sorts `slide10` before `slide2`.
 *
 * Namespace prefixes are treated as arbitrary throughout. `p:` and `a:` are
 * conventional, not required: they are bound to namespaces in the document and
 * a writer may pick any letters. Every match here is on the local name.
 */

export type SlidePreview = {
  /** 1-based position in the presentation, hidden slides included. */
  index: number;
  title: string;
  text: string;
  /** Set to skip during a show. Included, because the content is still there. */
  hidden: boolean;
};

export type PptxPreview = {
  slides: SlidePreview[];
  totalSlides: number;
  /** Slides named by the presentation whose part was missing or unreadable. */
  skipped: number;
  /** Slides or characters were left out on top of what `partial` already says. */
  truncated: boolean;
  /** Always true: this format is never extracted whole. See the note above. */
  partial: true;
};

/** Slides read. Beyond this a deck is a document, not something to preview. */
export const PREVIEW_MAX_SLIDES = 200;

export async function parsePptxPreview(
  content: Buffer,
  opts: { maxSlides?: number; maxChars?: number } = {},
): Promise<PptxPreview> {
  const maxSlides = Math.max(1, opts.maxSlides ?? PREVIEW_MAX_SLIDES);
  const maxChars = Math.max(1, opts.maxChars ?? 200_000);

  const pkg = await OoxmlPackage.open(content);
  const parser = await createParser();

  const presentation = await pkg.read("ppt/presentation.xml");
  if (!presentation) {
    throw new OoxmlError("No ppt/presentation.xml", "not_a_zip");
  }
  const rels = await pkg.read("ppt/_rels/presentation.xml.rels");

  const order = slideOrder(
    parser.parse(presentation),
    rels ? parser.parse(rels) : null,
  );
  const totalSlides = order.length;

  const slides: SlidePreview[] = [];
  let skipped = 0;
  let used = 0;
  let truncated = totalSlides > maxSlides;

  for (const [position, path] of order.slice(0, maxSlides).entries()) {
    let xml: string | null = null;
    try {
      xml = await pkg.read(path);
    } catch {
      // One unreadable part does not lose the rest of the deck.
      xml = null;
    }
    if (!xml) {
      skipped += 1;
      continue;
    }

    let slide: SlidePreview;
    try {
      slide = readSlide(parser.parse(xml), position + 1);
    } catch {
      skipped += 1;
      continue;
    }

    const cost = slide.title.length + slide.text.length;
    if (used + cost > maxChars) {
      truncated = true;
      break;
    }
    used += cost;
    slides.push(slide);
  }

  return { slides, totalSlides, skipped, truncated, partial: true };
}

export function formatPptxPreviewText(
  name: string,
  preview: PptxPreview,
): string {
  const header = `Here is the text of the presentation ${name} (${preview.totalSlides} slide${
    preview.totalSlides === 1 ? "" : "s"
  }). Text only: charts, SmartArt, embedded workbooks and speaker notes are not included.`;

  const blocks = preview.slides.map((slide) => {
    const heading = `### Slide ${slide.index}${slide.title ? `: ${slide.title}` : ""}${
      slide.hidden ? " (hidden)" : ""
    }`;
    return `${heading}\n\n${slide.text || "(no text)"}`;
  });

  const notes: string[] = [];
  if (preview.skipped > 0) {
    notes.push(`${preview.skipped} slide(s) could not be read.`);
  }
  if (preview.truncated) {
    notes.push("Not every slide is shown.");
  }
  notes.push(
    "Use python-execution to open the file if the question needs anything not shown here.",
  );

  return `${header}\n\n${blocks.join("\n\n")}\n\n${notes.join(" ")}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type XmlNode = Record<string, unknown>;

async function createParser() {
  const { XMLParser } = await import("fast-xml-parser");
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // Prefixes are kept: `removeNSPrefix` strips them from attributes too, and
    // `<p:sldId id="256" r:id="rId2"/>` would then have two `id` attributes
    // with one silently overwriting the other. Local names are matched instead.
    removeNSPrefix: false,
    // Runs carry meaningful leading and trailing spaces (`xml:space="preserve"`),
    // so trimming would join words. Whitespace *between* elements is dropped by
    // only ever reading text inside `a:t`.
    trimValues: false,
    parseAttributeValue: false,
    // The five built-in entities are everywhere in Office XML. Expansion bombs
    // are foreclosed by refusing a part that declares a DOCTYPE at all, in
    // `ooxml.ts`, before this parser sees it.
    processEntities: true,
  });
}

const localName = (key: string): string => key.slice(key.indexOf(":") + 1);

const asArray = (value: unknown): unknown[] =>
  value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? value
      : [value];

/** Direct children of a node whose local name matches, in document order. */
function childrenNamed(node: unknown, name: string): unknown[] {
  if (!node || typeof node !== "object") return [];
  const out: unknown[] = [];
  for (const [key, value] of Object.entries(node as XmlNode)) {
    if (key.startsWith("@_") || key === "#text") continue;
    if (localName(key) === name) out.push(...asArray(value));
  }
  return out;
}

/** The first descendant with this local name, breadth-first. */
function findNamed(node: unknown, name: string): unknown {
  const queue: unknown[] = [node];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    for (const [key, value] of Object.entries(current as XmlNode)) {
      if (key.startsWith("@_") || key === "#text") continue;
      if (localName(key) === name) return asArray(value)[0];
      queue.push(...asArray(value));
    }
  }
  return undefined;
}

function attribute(node: unknown, name: string): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  for (const [key, value] of Object.entries(node as XmlNode)) {
    if (!key.startsWith("@_")) continue;
    if (localName(key.slice(2)) === name) return String(value);
  }
  return undefined;
}

/**
 * The relationship id attribute, which is the namespaced `id` rather than the
 * plain one. Distinguishing them by whether the name is qualified is what keeps
 * this working when a writer renames the `r:` prefix.
 */
function relationshipId(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  for (const [key, value] of Object.entries(node as XmlNode)) {
    if (!key.startsWith("@_")) continue;
    const attributeName = key.slice(2);
    if (attributeName.includes(":") && localName(attributeName) === "id") {
      return String(value);
    }
  }
  return undefined;
}

/** Slide part paths, in presentation order. */
function slideOrder(presentation: unknown, rels: unknown): string[] {
  const targets = new Map<string, string>();
  for (const relationship of childrenNamed(
    findNamed(rels, "Relationships") ?? rels,
    "Relationship",
  )) {
    const id = attribute(relationship, "Id");
    const target = attribute(relationship, "Target");
    if (!id || !target) continue;
    // An external relationship points outside the package; following one would
    // be a request to a URL the file chose.
    if (attribute(relationship, "TargetMode") === "External") continue;
    // First wins: a duplicate id is malformed, and picking the later one would
    // let a crafted file shadow a legitimate relationship.
    if (!targets.has(id)) targets.set(id, resolveRelTarget("ppt", target));
  }

  const list = findNamed(presentation, "sldIdLst");
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const entry of childrenNamed(list, "sldId")) {
    const id = relationshipId(entry);
    if (!id) continue;
    const path = targets.get(id);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

function readSlide(parsed: unknown, index: number): SlidePreview {
  const slide = findNamed(parsed, "sld");
  const hidden = attribute(slide, "show") === "0";
  const tree = findNamed(slide ?? parsed, "spTree");

  const paragraphs: string[] = [];
  collectParagraphs(tree, paragraphs);

  return {
    index,
    title: titleOf(tree),
    text: paragraphs
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n"),
    hidden,
  };
}

/** The text of the shape holding a title placeholder, if there is one. */
function titleOf(tree: unknown): string {
  for (const shape of shapesOf(tree)) {
    const placeholder = findNamed(shape, "ph");
    const type = attribute(placeholder, "type");
    if (type !== "title" && type !== "ctrTitle") continue;
    const lines: string[] = [];
    collectParagraphs(shape, lines);
    const title = lines
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");
    if (title) return title;
  }
  return "";
}

/** Shapes at any depth, so one inside a group is still found. */
function shapesOf(node: unknown): unknown[] {
  const found: unknown[] = [];
  const walk = (current: unknown) => {
    if (!current || typeof current !== "object") return;
    for (const [key, value] of Object.entries(current as XmlNode)) {
      if (key.startsWith("@_") || key === "#text") continue;
      const name = localName(key);
      for (const child of asArray(value)) {
        if (name === "sp") found.push(child);
        walk(child);
      }
    }
  };
  walk(node);
  return found;
}

/**
 * Every paragraph's text, in document order.
 *
 * Walking the whole subtree rather than following the shape hierarchy is what
 * picks up table cells, grouped shapes and text boxes without a case for each.
 */
function collectParagraphs(node: unknown, out: string[]): void {
  if (!node || typeof node !== "object") return;

  for (const [key, value] of Object.entries(node as XmlNode)) {
    if (key.startsWith("@_") || key === "#text") continue;
    const name = localName(key);

    if (name === "AlternateContent") {
      // Read one branch, not both: `mc:Choice` and `mc:Fallback` are two
      // renderings of the same content, so taking both duplicates it. The
      // fallback is the one every reader is required to understand.
      for (const alternate of asArray(value)) {
        const fallback = childrenNamed(alternate, "Fallback");
        const chosen = fallback.length
          ? fallback
          : childrenNamed(alternate, "Choice");
        for (const branch of chosen) collectParagraphs(branch, out);
      }
      continue;
    }

    if (name === "p") {
      for (const paragraph of asArray(value)) out.push(runsOf(paragraph));
      continue;
    }

    for (const child of asArray(value)) collectParagraphs(child, out);
  }
}

/** One paragraph's runs, concatenated. */
function runsOf(paragraph: unknown): string {
  const runs: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as XmlNode)) {
      if (key.startsWith("@_") || key === "#text") continue;
      if (localName(key) === "t") {
        for (const run of asArray(value)) runs.push(textOf(run));
        continue;
      }
      for (const child of asArray(value)) walk(child);
    }
  };
  walk(paragraph);
  return runs.join("");
}

/**
 * The characters of one `a:t`.
 *
 * A run with attributes (`xml:space="preserve"`) parses to an object whose
 * `#text` holds the characters; one without parses to the string itself.
 */
function textOf(run: unknown): string {
  if (run === null || run === undefined) return "";
  if (typeof run === "object") {
    const text = (run as XmlNode)["#text"];
    return text === undefined || text === null ? "" : String(text);
  }
  return String(run);
}

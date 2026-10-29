/**
 * DOCX tracked-changes helpers.
 * Ported from willchen96/mike backend/src/lib/docxTrackedChanges.ts.
 *
 * `applyTrackedEdits` rewrites a .docx so that the requested substitutions
 * appear as `<w:ins>` / `<w:del>` tracked changes rather than direct text
 * replacements. `resolveTrackedChange` accepts or rejects one change by
 * its `w:id`, producing a new .docx with only that change collapsed.
 */

import JSZip from "jszip";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

// ---------------------------------------------------------------------------
// JSZip path helpers (handles both forward-slash and backslash archives)
// ---------------------------------------------------------------------------

function getZipEntry(zip: JSZip, pathSlash: string) {
  const direct = zip.file(pathSlash);
  if (direct) return direct;
  return zip.file(pathSlash.replace(/\//g, "\\"));
}

function setZipEntry(
  zip: JSZip,
  pathSlash: string,
  content: string | Buffer,
): void {
  const backslash = pathSlash.replace(/\//g, "\\");
  if (!zip.file(pathSlash) && zip.file(backslash)) {
    zip.file(backslash, content);
    return;
  }
  zip.file(pathSlash, content);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EditInput {
  find: string;
  replace: string;
  context_before: string;
  context_after: string;
  reason?: string;
}

export interface AppliedChange {
  id: string;
  delId?: string;
  insId?: string;
  deletedText: string;
  insertedText: string;
  contextBefore: string;
  contextAfter: string;
  reason?: string;
}

export interface EditError {
  index: number;
  reason: string;
}

export interface ApplyTrackedEditsResult {
  bytes: Buffer;
  changes: AppliedChange[];
  errors: EditError[];
}

// ---------------------------------------------------------------------------
// Preserve-order tree helpers
// ---------------------------------------------------------------------------

type XNode = Record<string, unknown>;

const ATTR_KEY = ":@";
const TEXT_KEY = "#text";

function elName(n: unknown): string | null {
  if (!n || typeof n !== "object") return null;
  for (const k of Object.keys(n as XNode)) {
    if (k === ATTR_KEY || k === TEXT_KEY) continue;
    return k;
  }
  return null;
}

function isTextNode(n: unknown): n is { [TEXT_KEY]: string } {
  if (!n || typeof n !== "object") return false;
  const obj = n as XNode;
  return TEXT_KEY in obj && elName(n) === null;
}

function elChildren(n: unknown): XNode[] {
  const name = elName(n);
  if (!name) return [];
  const v = (n as XNode)[name];
  return Array.isArray(v) ? (v as XNode[]) : [];
}

function setChildren(n: XNode, children: XNode[]): void {
  const name = elName(n);
  if (!name) return;
  n[name] = children;
}

function elAttrs(n: unknown): Record<string, string> {
  if (!n || typeof n !== "object") return {};
  const a = (n as XNode)[ATTR_KEY];
  return (a as Record<string, string>) ?? {};
}

function makeEl(
  name: string,
  children: XNode[] = [],
  attrs?: Record<string, string>,
): XNode {
  const el: XNode = { [name]: children };
  if (attrs) {
    const attrObj: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) {
      attrObj[`@_${k}`] = v;
    }
    el[ATTR_KEY] = attrObj;
  }
  return el;
}

function makeText(s: string): XNode {
  return { [TEXT_KEY]: s };
}

function getTextContent(wtEl: XNode): string {
  const kids = elChildren(wtEl);
  let out = "";
  for (const k of kids) {
    if (isTextNode(k)) out += String(k[TEXT_KEY] ?? "");
  }
  return out;
}

function buildRun(
  rPr: XNode | null,
  text: string,
  tagName: "w:t" | "w:delText",
): XNode {
  const children: XNode[] = [];
  if (rPr) children.push(cloneNode(rPr));
  const segments = text.split("\n");
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) children.push(makeEl("w:br", []));
    const seg = segments[i];
    if (seg.length > 0) {
      children.push(
        makeEl(tagName, [makeText(seg)], { "xml:space": "preserve" }),
      );
    }
  }
  return makeEl("w:r", children);
}

function cloneNode<T>(n: T): T {
  return JSON.parse(JSON.stringify(n)) as T;
}

// ---------------------------------------------------------------------------
// Paragraph flattening
// ---------------------------------------------------------------------------

interface RunSlot {
  childIndex: number;
  rPr: XNode | null;
  textNodes: {
    wtEl: XNode;
    text: string;
    paraStart: number;
    paraEnd: number;
  }[];
}

interface Flattened {
  paraText: string;
  charRun: Int32Array;
  charTextNode: Int32Array;
  charOffset: Int32Array;
  runs: RunSlot[];
}

function flattenParagraph(paraChildren: XNode[]): Flattened {
  const runs: RunSlot[] = [];
  let paraText = "";
  const charRunArr: number[] = [];
  const charTextNodeArr: number[] = [];
  const charOffsetArr: number[] = [];

  const processRun = (rEl: XNode, topChildIdx: number) => {
    const rKids = elChildren(rEl);
    let rPr: XNode | null = null;
    const textNodes: RunSlot["textNodes"] = [];
    for (const rk of rKids) {
      const name = elName(rk);
      if (name === "w:rPr") {
        rPr = rk;
      } else if (name === "w:t") {
        const txt = getTextContent(rk);
        const start = paraText.length;
        textNodes.push({
          wtEl: rk,
          text: txt,
          paraStart: start,
          paraEnd: start + txt.length,
        });
        const runIdx = runs.length;
        const tnIdx = textNodes.length - 1;
        paraText += txt;
        for (let i = 0; i < txt.length; i++) {
          charRunArr.push(runIdx);
          charTextNodeArr.push(tnIdx);
          charOffsetArr.push(i);
        }
      }
    }
    runs.push({ childIndex: topChildIdx, rPr, textNodes });
  };

  for (let ci = 0; ci < paraChildren.length; ci++) {
    const child = paraChildren[ci];
    const name = elName(child);
    if (name === "w:r") {
      processRun(child, ci);
    } else if (name === "w:ins") {
      for (const inner of elChildren(child)) {
        if (elName(inner) === "w:r") processRun(inner, ci);
      }
    }
  }

  return {
    paraText,
    charRun: Int32Array.from(charRunArr),
    charTextNode: Int32Array.from(charTextNodeArr),
    charOffset: Int32Array.from(charOffsetArr),
    runs,
  };
}

// ---------------------------------------------------------------------------
// Planning edits on a paragraph
// ---------------------------------------------------------------------------

interface PlannedChange {
  editIndex: number;
  deleteStart: number;
  deleteEnd: number;
  deletedText: string;
  insertedText: string;
  contextBefore: string;
  contextAfter: string;
  reason?: string;
  changeId: string;
  delWId?: string;
  insWId?: string;
}

function collapseDiff(
  find: string,
  replace: string,
): {
  deleted: string;
  inserted: string;
  leadingEq: number;
  trailingEq: number;
} {
  let leading = 0;
  const minLen = Math.min(find.length, replace.length);
  while (leading < minLen && find[leading] === replace[leading]) leading++;
  let trailing = 0;
  while (
    trailing < minLen - leading &&
    find[find.length - 1 - trailing] === replace[replace.length - 1 - trailing]
  ) {
    trailing++;
  }
  const deleted = find.slice(leading, find.length - trailing);
  const inserted = replace.slice(leading, replace.length - trailing);
  return { deleted, inserted, leadingEq: leading, trailingEq: trailing };
}

// ---------------------------------------------------------------------------
// Paragraph reconstruction
// ---------------------------------------------------------------------------

function reconstructParagraph(
  paraChildren: XNode[],
  flat: Flattened,
  plan: PlannedChange[],
  now: string,
  author: string,
): XNode[] {
  if (plan.length === 0) return paraChildren;

  let firstRunIdx = flat.runs.length;
  let lastRunIdx = -1;
  for (const p of plan) {
    for (let pos = p.deleteStart; pos < p.deleteEnd; pos++) {
      const r = flat.charRun[pos];
      if (r < firstRunIdx) firstRunIdx = r;
      if (r > lastRunIdx) lastRunIdx = r;
    }
    if (p.deleteStart === p.deleteEnd && p.deleteStart < flat.paraText.length) {
      const r = flat.charRun[p.deleteStart];
      if (r < firstRunIdx) firstRunIdx = r;
      if (r > lastRunIdx) lastRunIdx = r;
    } else if (p.deleteStart === p.deleteEnd && p.deleteStart > 0) {
      const r = flat.charRun[p.deleteStart - 1];
      if (r < firstRunIdx) firstRunIdx = r;
      if (r > lastRunIdx) lastRunIdx = r;
    }
  }
  if (firstRunIdx > lastRunIdx) return paraChildren;

  const startChildIdx = flat.runs[firstRunIdx].childIndex;
  const endChildIdx = flat.runs[lastRunIdx].childIndex;

  const firstRun = flat.runs[firstRunIdx];
  const lastRun = flat.runs[lastRunIdx];
  const spanStart =
    firstRun.textNodes.length > 0 ? firstRun.textNodes[0].paraStart : 0;
  const spanEnd =
    lastRun.textNodes.length > 0
      ? lastRun.textNodes[lastRun.textNodes.length - 1].paraEnd
      : spanStart;

  const newRunGroup: XNode[] = [];

  const rPrForPos = (pos: number): XNode | null => {
    if (pos < 0) pos = 0;
    if (pos >= flat.paraText.length) pos = flat.paraText.length - 1;
    if (pos < 0) return firstRun.rPr;
    return flat.runs[flat.charRun[pos]].rPr;
  };

  const emitNormal = (a: number, b: number) => {
    if (a >= b) return;
    let i = a;
    while (i < b) {
      const runIdx = flat.charRun[i];
      const tnIdx = flat.charTextNode[i];
      let j = i + 1;
      while (
        j < b &&
        flat.charRun[j] === runIdx &&
        flat.charTextNode[j] === tnIdx
      )
        j++;
      const slot = flat.runs[runIdx];
      const slice = flat.paraText.slice(i, j);
      newRunGroup.push(buildRun(slot.rPr, slice, "w:t"));
      i = j;
    }
  };

  const emitDel = (a: number, b: number, wId: string) => {
    if (a >= b) return;
    const inner: XNode[] = [];
    let i = a;
    while (i < b) {
      const runIdx = flat.charRun[i];
      const tnIdx = flat.charTextNode[i];
      let j = i + 1;
      while (
        j < b &&
        flat.charRun[j] === runIdx &&
        flat.charTextNode[j] === tnIdx
      )
        j++;
      const slot = flat.runs[runIdx];
      const slice = flat.paraText.slice(i, j);
      inner.push(buildRun(slot.rPr, slice, "w:delText"));
      i = j;
    }
    newRunGroup.push(
      makeEl("w:del", inner, {
        "w:id": wId,
        "w:author": author,
        "w:date": now,
      }),
    );
  };

  const emitIns = (pos: number, text: string, wId: string) => {
    if (!text) return;
    const rPr = rPrForPos(pos === spanEnd ? pos - 1 : pos);
    const run = buildRun(rPr, text, "w:t");
    newRunGroup.push(
      makeEl("w:ins", [run], {
        "w:id": wId,
        "w:author": author,
        "w:date": now,
      }),
    );
  };

  let cursor = spanStart;
  for (const p of plan) {
    emitNormal(cursor, p.deleteStart);
    if (p.insertedText) emitIns(p.deleteStart, p.insertedText, p.insWId!);
    if (p.deleteEnd > p.deleteStart)
      emitDel(p.deleteStart, p.deleteEnd, p.delWId!);
    cursor = p.deleteEnd;
  }
  emitNormal(cursor, spanEnd);

  const droppedChildIdx = new Set<number>();
  for (let r = firstRunIdx; r <= lastRunIdx; r++) {
    droppedChildIdx.add(flat.runs[r].childIndex);
  }
  for (let i = startChildIdx; i <= endChildIdx; i++) {
    if (elName(paraChildren[i]) === "w:del") droppedChildIdx.add(i);
  }
  const firstDroppedIdx = startChildIdx;
  void endChildIdx;
  const out: XNode[] = [];
  for (let i = 0; i < paraChildren.length; i++) {
    if (i === firstDroppedIdx) {
      for (const n of newRunGroup) out.push(n);
    }
    if (droppedChildIdx.has(i)) continue;
    out.push(paraChildren[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Locating context in the document
// ---------------------------------------------------------------------------

interface ParagraphRef {
  paraNode: XNode;
  paraChildren: XNode[];
  flat: Flattened;
  globalStart: number;
}

interface Normalized {
  norm: string;
  origIdx: number[];
}

function preNormalize(s: string): string {
  return s
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, " ");
}

function normalizeWs(input: string): Normalized {
  const s = preNormalize(input);
  const norm: string[] = [];
  const origIdx: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        norm.push(" ");
        origIdx.push(i);
        prevSpace = true;
      }
    } else {
      norm.push(ch);
      origIdx.push(i);
      prevSpace = false;
    }
  }
  return { norm: norm.join(""), origIdx };
}

function findUniqueAnchor(
  hayNorm: string,
  findNorm: string,
  ctxBeforeNorm: string,
  ctxAfterNorm: string,
): { start: number; end: number } | { error: "none" | "ambiguous" } {
  const candidates: number[] = [];

  const checkCtx = (pos: number): boolean => {
    if (ctxBeforeNorm) {
      const start = pos - ctxBeforeNorm.length;
      if (start < 0) return false;
      if (hayNorm.slice(start, pos) !== ctxBeforeNorm) return false;
    }
    if (ctxAfterNorm) {
      const end = pos + findNorm.length;
      if (hayNorm.slice(end, end + ctxAfterNorm.length) !== ctxAfterNorm)
        return false;
    }
    return true;
  };

  if (findNorm.length === 0) {
    for (let i = 0; i <= hayNorm.length; i++) {
      if (checkCtx(i)) candidates.push(i);
    }
  } else {
    let from = 0;
    while (from <= hayNorm.length - findNorm.length) {
      const idx = hayNorm.indexOf(findNorm, from);
      if (idx < 0) break;
      if (checkCtx(idx)) candidates.push(idx);
      from = idx + 1;
    }
  }

  if (candidates.length === 0) return { error: "none" };
  if (candidates.length > 1) return { error: "ambiguous" };
  return { start: candidates[0], end: candidates[0] + findNorm.length };
}

function mapNormRangeToOriginal(
  paraNorm: Normalized,
  origLen: number,
  normStart: number,
  normEnd: number,
): { start: number; end: number } {
  const origStart =
    normStart < paraNorm.origIdx.length ? paraNorm.origIdx[normStart] : origLen;
  const origEnd =
    normEnd === normStart
      ? origStart
      : normEnd - 1 < paraNorm.origIdx.length
        ? paraNorm.origIdx[normEnd - 1] + 1
        : origLen;
  return { start: origStart, end: origEnd };
}

// ---------------------------------------------------------------------------
// XML parser/builder factories
// ---------------------------------------------------------------------------

function createParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    trimValues: false,
    parseAttributeValue: false,
    processEntities: true,
  });
}

function createBuilder() {
  return new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    suppressEmptyNode: false,
    processEntities: true,
  });
}

function findBody(doc: XNode[]): XNode[] | null {
  for (const top of doc) {
    if (elName(top) === "w:document") {
      for (const c of elChildren(top)) {
        if (elName(c) === "w:body") return elChildren(c);
      }
    }
  }
  return null;
}

function replaceBody(doc: XNode[], bodyChildren: XNode[]): void {
  for (const top of doc) {
    if (elName(top) !== "w:document") continue;
    const docKids = elChildren(top);
    for (const c of docKids) {
      if (elName(c) === "w:body") setChildren(c, bodyChildren);
    }
  }
}
void replaceBody; // available but not used directly

function maxTrackedId(doc: XNode[]): number {
  let max = 0;
  const visit = (n: unknown) => {
    const name = elName(n);
    if (!name) return;
    if (name === "w:ins" || name === "w:del") {
      const a = elAttrs(n);
      const raw = a["@_w:id"];
      if (raw != null) {
        const v = parseInt(String(raw), 10);
        if (Number.isFinite(v) && v > max) max = v;
      }
    }
    for (const c of elChildren(n as XNode)) visit(c);
  };
  for (const top of doc) visit(top);
  return max;
}

// ---------------------------------------------------------------------------
// Exported: extractDocxBodyText
// ---------------------------------------------------------------------------

export async function extractDocxBodyText(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const docXmlFile = getZipEntry(zip, "word/document.xml");
  if (!docXmlFile) return "";
  const docXmlRaw = await docXmlFile.async("string");
  const parser = createParser();
  const tree = parser.parse(docXmlRaw) as XNode[];
  const bodyChildren = findBody(tree);
  if (!bodyChildren) return "";

  const lines: string[] = [];
  const collect = (nodes: XNode[]) => {
    for (const n of nodes) {
      const name = elName(n);
      if (!name) continue;
      if (name === "w:p") {
        const flat = flattenParagraph(elChildren(n));
        lines.push(flat.paraText);
      } else if (
        ["w:tbl", "w:tr", "w:tc", "w:sdt", "w:sdtContent"].includes(name)
      ) {
        collect(elChildren(n));
      }
    }
  };
  collect(bodyChildren);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Exported: extractTrackedChangeIds
// ---------------------------------------------------------------------------

export async function extractTrackedChangeIds(
  bytes: Buffer,
): Promise<{ kind: "ins" | "del"; w_id: string }[]> {
  const zip = await JSZip.loadAsync(bytes);
  const docXmlFile = getZipEntry(zip, "word/document.xml");
  if (!docXmlFile) return [];
  const docXmlRaw = await docXmlFile.async("string");
  const parser = createParser();
  const tree = parser.parse(docXmlRaw) as XNode[];
  const out: { kind: "ins" | "del"; w_id: string }[] = [];
  const visit = (n: unknown) => {
    const name = elName(n);
    if (!name) return;
    if (name === "w:ins" || name === "w:del") {
      const a = elAttrs(n);
      const raw = a["@_w:id"];
      if (raw != null) {
        out.push({ kind: name === "w:ins" ? "ins" : "del", w_id: String(raw) });
      }
    }
    for (const c of elChildren(n as XNode)) visit(c);
  };
  for (const top of tree) visit(top);
  return out;
}

// ---------------------------------------------------------------------------
// Exported: applyTrackedEdits
// ---------------------------------------------------------------------------

export async function applyTrackedEdits(
  bytes: Buffer,
  edits: EditInput[],
  opts?: { author?: string },
): Promise<ApplyTrackedEditsResult> {
  const author = opts?.author ?? "AI Assistant";
  const now = new Date().toISOString();

  const zip = await JSZip.loadAsync(bytes);
  const docXmlFile = getZipEntry(zip, "word/document.xml");
  if (!docXmlFile) throw new Error("document.xml missing from docx");
  const docXmlRaw = await docXmlFile.async("string");

  const parser = createParser();
  const tree = parser.parse(docXmlRaw) as XNode[];

  const bodyChildren = findBody(tree);
  if (!bodyChildren) throw new Error("w:body missing from document.xml");

  const paragraphs: ParagraphRef[] = [];
  const collectParagraphs = (nodes: XNode[]) => {
    for (const n of nodes) {
      const name = elName(n);
      if (!name) continue;
      if (name === "w:p") {
        const kids = elChildren(n);
        const flat = flattenParagraph(kids);
        paragraphs.push({
          paraNode: n,
          paraChildren: kids,
          flat,
          globalStart: 0,
        });
      } else if (
        ["w:tbl", "w:tr", "w:tc", "w:sdt", "w:sdtContent"].includes(name)
      ) {
        collectParagraphs(elChildren(n));
      }
    }
  };
  collectParagraphs(bodyChildren);

  {
    let off = 0;
    for (const p of paragraphs) {
      p.globalStart = off;
      off += p.flat.paraText.length + 1;
    }
  }

  const paraNorms: Normalized[] = paragraphs.map((p) =>
    normalizeWs(p.flat.paraText),
  );

  let nextWId = maxTrackedId(tree) + 1;
  const plansPerParagraph = new Map<number, PlannedChange[]>();
  const appliedChanges: AppliedChange[] = [];
  const errors: EditError[] = [];

  for (let editIdx = 0; editIdx < edits.length; editIdx++) {
    const edit = edits[editIdx];
    const find = edit.find ?? "";
    const replace = edit.replace ?? "";
    const ctxBefore = edit.context_before ?? "";
    const ctxAfter = edit.context_after ?? "";

    if (!find && !replace) {
      errors.push({ index: editIdx, reason: "Empty edit." });
      continue;
    }
    if (!find && !ctxBefore && !ctxAfter) {
      errors.push({
        index: editIdx,
        reason: "Pure insertion requires context_before or context_after.",
      });
      continue;
    }

    const findNorm = normalizeWs(find).norm;
    const ctxBeforeNorm = normalizeWs(ctxBefore).norm;
    const ctxAfterNorm = normalizeWs(ctxAfter).norm;

    type Hit = { paraIdx: number; normStart: number; normEnd: number };

    const tryStrategy = (
      cb: string,
      ca: string,
    ): { kind: "ok"; hits: Hit[] } | { kind: "ambiguous" } => {
      const hits: Hit[] = [];
      let ambiguous = false;
      for (let pi = 0; pi < paragraphs.length; pi++) {
        const r = findUniqueAnchor(paraNorms[pi].norm, findNorm, cb, ca);
        if ("error" in r) {
          if (r.error === "ambiguous") ambiguous = true;
          continue;
        }
        hits.push({ paraIdx: pi, normStart: r.start, normEnd: r.end });
      }
      if (ambiguous || hits.length > 1) return { kind: "ambiguous" };
      return { kind: "ok", hits };
    };

    let selected: Hit | null = null;
    const attempts = [
      { cb: ctxBeforeNorm, ca: ctxAfterNorm },
      { cb: ctxBeforeNorm, ca: "" },
      { cb: "", ca: ctxAfterNorm },
      { cb: "", ca: "" },
    ];
    let sawAmbiguous = false;
    for (const { cb, ca } of attempts) {
      const r = tryStrategy(cb, ca);
      if (r.kind === "ambiguous") {
        sawAmbiguous = true;
        continue;
      }
      if (r.hits.length === 1) {
        selected = r.hits[0];
        break;
      }
    }

    if (!selected) {
      errors.push({
        index: editIdx,
        reason: sawAmbiguous
          ? `Ambiguous match for find="${truncate(find, 80)}". Add longer context_before / context_after.`
          : `Could not locate find="${truncate(find, 80)}" in the document.`,
      });
      continue;
    }

    const hit = selected;
    const paraIdx = hit.paraIdx;
    const paraNorm = paraNorms[paraIdx];
    const origLen = paragraphs[paraIdx].flat.paraText.length;
    const { start: findStart, end: findEnd } = mapNormRangeToOriginal(
      paraNorm,
      origLen,
      hit.normStart,
      hit.normEnd,
    );

    const originalFind = paragraphs[paraIdx].flat.paraText.slice(
      findStart,
      findEnd,
    );
    const { deleted, inserted, leadingEq } = collapseDiff(
      originalFind,
      replace,
    );
    const minStart = findStart + leadingEq;
    const minEnd = minStart + deleted.length;
    void findEnd;

    const changeId = `ai-${editIdx}-${Date.now()}`;
    const plan: PlannedChange = {
      editIndex: editIdx,
      deleteStart: minStart,
      deleteEnd: minEnd,
      deletedText: deleted,
      insertedText: inserted,
      contextBefore: edit.context_before ?? "",
      contextAfter: edit.context_after ?? "",
      reason: edit.reason,
      changeId,
      delWId: deleted ? String(nextWId++) : undefined,
      insWId: inserted ? String(nextWId++) : undefined,
    };

    const existing = plansPerParagraph.get(paraIdx) ?? [];
    const overlap = existing.some(
      (p) =>
        !(plan.deleteEnd <= p.deleteStart || plan.deleteStart >= p.deleteEnd),
    );
    if (overlap) {
      errors.push({
        index: editIdx,
        reason: "Overlaps a previous edit in the same paragraph.",
      });
      continue;
    }

    existing.push(plan);
    existing.sort((a, b) => a.deleteStart - b.deleteStart);
    plansPerParagraph.set(paraIdx, existing);

    appliedChanges.push({
      id: changeId,
      delId: plan.delWId,
      insId: plan.insWId,
      deletedText: plan.deletedText,
      insertedText: plan.insertedText,
      contextBefore: plan.contextBefore,
      contextAfter: plan.contextAfter,
      reason: plan.reason,
    });
  }

  for (const [paraIdx, plan] of plansPerParagraph) {
    const p = paragraphs[paraIdx];
    const newKids = reconstructParagraph(
      p.paraChildren,
      p.flat,
      plan,
      now,
      author,
    );
    setChildren(p.paraNode, newKids);
  }

  const builder = createBuilder();
  const rebuiltXml = builder.build(tree);
  const withDecl = ensureXmlDeclaration(rebuiltXml);
  setZipEntry(zip, "word/document.xml", withDecl);

  const outBuf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  return { bytes: outBuf, changes: appliedChanges, errors };
}

// ---------------------------------------------------------------------------
// Exported: resolveTrackedChange
// ---------------------------------------------------------------------------

function unwrapDelText(n: XNode): XNode {
  const name = elName(n);
  if (!name) return n;
  if (name === "w:r") {
    const kids = elChildren(n).map(unwrapDelText);
    setChildren(n, kids);
    return n;
  }
  if (name === "w:delText") {
    const attrs = elAttrs(n);
    return {
      "w:t": elChildren(n),
      ...(Object.keys(attrs).length ? { [ATTR_KEY]: attrs } : {}),
    };
  }
  return n;
}

function resolveInTree(
  doc: XNode[],
  changeIds: string[],
  mode: "accept" | "reject",
): { found: boolean } {
  const ids = new Set(changeIds.map((s) => String(s)));
  let touched = false;

  const rewrite = (parentKids: XNode[]): XNode[] => {
    const out: XNode[] = [];
    for (const n of parentKids) {
      const name = elName(n);
      if (!name) {
        out.push(n);
        continue;
      }

      const kids = elChildren(n);
      if (kids.length) {
        const newKids = rewrite(kids);
        if (newKids !== kids) setChildren(n, newKids);
      }

      if (name === "w:ins" || name === "w:del") {
        const a = elAttrs(n);
        const wId = String(a["@_w:id"] ?? "");
        if (ids.has(wId)) {
          touched = true;
          if (
            (name === "w:ins" && mode === "accept") ||
            (name === "w:del" && mode === "reject")
          ) {
            const inner =
              name === "w:del"
                ? (elChildren(n) as XNode[]).map(unwrapDelText)
                : (elChildren(n) as XNode[]);
            for (const c of inner) out.push(c);
            continue;
          } else {
            continue;
          }
        }
      }
      out.push(n);
    }
    return out;
  };

  for (const top of doc) {
    if (elName(top) !== "w:document") continue;
    const docKids = elChildren(top);
    setChildren(top, rewrite(docKids));
  }
  return { found: touched };
}

export async function resolveTrackedChange(
  bytes: Buffer,
  changeIds: string[],
  mode: "accept" | "reject",
): Promise<{ bytes: Buffer; found: boolean }> {
  const zip = await JSZip.loadAsync(bytes);
  const docXmlFile = getZipEntry(zip, "word/document.xml");
  if (!docXmlFile) throw new Error("document.xml missing from docx");
  const docXmlRaw = await docXmlFile.async("string");

  const parser = createParser();
  const tree = parser.parse(docXmlRaw) as XNode[];

  const { found } = resolveInTree(tree, changeIds, mode);

  const builder = createBuilder();
  const rebuilt = ensureXmlDeclaration(builder.build(tree));
  setZipEntry(zip, "word/document.xml", rebuilt);
  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  return { bytes: out, found };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function ensureXmlDeclaration(xml: string): string {
  if (xml.startsWith("<?xml")) return xml;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`;
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

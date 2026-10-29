import type { Buffer } from "node:buffer";

/**
 * Opening an OOXML file safely.
 *
 * A .docx/.pptx/.xlsx is a zip, and a zip that arrives from a user is a set of
 * claims about what is inside it, not a fact. Nothing in this repo defended
 * against that before: `apply-tracked-edits.ts` calls `JSZip.loadAsync` on the
 * bytes and reads whatever it finds. Three things go wrong without the guards
 * below, all of them on an instance Fluid Compute shares with live requests:
 *
 * - **A compression bomb.** A 1 KB archive can inflate to gigabytes. The
 *   central directory states each entry's uncompressed size before any of it is
 *   inflated, so the cheap check is to believe the header enough to *refuse*,
 *   and to re-check the real length afterwards in case it lied.
 * - **Entry count.** Ten thousand tiny entries cost nothing to compress and a
 *   great deal to enumerate and hold.
 * - **Reading parts nobody asked for.** Embedded media, fonts and workbooks are
 *   the bulk of a real deck's bytes and none of it is text. Only allowlisted
 *   paths are ever inflated.
 *
 * Entity expansion is handled by refusing a part that declares a DOCTYPE at
 * all, before `XMLParser` sees it. `processEntities: true` is kept for the five
 * built-in entities, which real Office XML uses constantly.
 */

/** Entries an archive may contain before it is refused. */
export const MAX_ZIP_ENTRIES = 2_000;
/** Inflated bytes any single entry may hold. */
export const MAX_ZIP_ENTRY_BYTES = 20 * 1024 * 1024;
/** Inflated bytes read from one archive in total. */
export const MAX_ZIP_INFLATED_BYTES = 60 * 1024 * 1024;

/** A file that is not a readable OOXML package. */
export class OoxmlError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_a_zip"
      | "too_many_entries"
      | "entry_too_large"
      | "inflated_too_large"
      | "doctype",
  ) {
    super(message);
    this.name = "OoxmlError";
  }
}

/** Only what this module uses, so the jszip type does not leak into callers. */
type ZipEntry = {
  name: string;
  dir: boolean;
  async: (type: "string") => Promise<string>;
};
type Zip = {
  file: (path: string) => ZipEntry | null;
  forEach: (callback: (path: string, entry: ZipEntry) => void) => void;
};

/**
 * An OOXML package, opened with the caps applied and a budget that shrinks as
 * parts are read.
 */
export class OoxmlPackage {
  private inflated = 0;

  private constructor(private readonly zip: Zip) {}

  static async open(content: Buffer): Promise<OoxmlPackage> {
    // jszip is a megabyte of parser; only this path needs it.
    const { default: JSZip } = await import("jszip");

    let zip: Zip;
    try {
      // An encrypted archive (Office's "password to open") throws here, which
      // is the right answer: there is nothing to read.
      zip = (await JSZip.loadAsync(content)) as unknown as Zip;
    } catch (error) {
      throw new OoxmlError(
        `Not a readable archive: ${String(error)}`,
        "not_a_zip",
      );
    }

    let entries = 0;
    let declared = 0;
    zip.forEach((_path, entry) => {
      if (entry.dir) return;
      entries += 1;
      declared += uncompressedSizeOf(entry);
    });

    if (entries > MAX_ZIP_ENTRIES) {
      throw new OoxmlError(
        `${entries} entries is over the ${MAX_ZIP_ENTRIES} cap`,
        "too_many_entries",
      );
    }
    // The header is a claim, so this is a cheap refusal rather than the whole
    // defence — `read` re-checks the real length after inflating.
    if (declared > MAX_ZIP_INFLATED_BYTES) {
      throw new OoxmlError(
        "The archive claims more inflated bytes than the cap allows",
        "inflated_too_large",
      );
    }

    return new OoxmlPackage(zip);
  }

  /** Whether a part exists, without inflating it. */
  has(path: string): boolean {
    return this.entry(path) !== null;
  }

  /**
   * One part as text, or null when it is absent.
   *
   * A missing part is never an error here: a deck with no relationships file is
   * malformed, not hostile, and the caller decides whether it can carry on.
   */
  async read(path: string): Promise<string | null> {
    const entry = this.entry(path);
    if (!entry) return null;

    const declared = uncompressedSizeOf(entry);
    if (declared > MAX_ZIP_ENTRY_BYTES) {
      throw new OoxmlError(
        `${path} is over the per-entry cap`,
        "entry_too_large",
      );
    }
    if (this.inflated + declared > MAX_ZIP_INFLATED_BYTES) {
      throw new OoxmlError(
        "Reading this part would pass the archive's inflated-bytes budget",
        "inflated_too_large",
      );
    }

    const text = await entry.async("string");
    // The fallback for a header that lied, or that jszip did not expose.
    if (text.length > MAX_ZIP_ENTRY_BYTES) {
      throw new OoxmlError(
        `${path} inflated past the per-entry cap`,
        "entry_too_large",
      );
    }
    this.inflated += text.length;
    if (this.inflated > MAX_ZIP_INFLATED_BYTES) {
      throw new OoxmlError(
        "The archive inflated past its budget",
        "inflated_too_large",
      );
    }

    assertNoDoctype(path, text);
    return text;
  }

  /**
   * Paths matching a prefix and suffix, e.g. every `ppt/slides/slideN.xml`.
   * Never used to decide what to read — the caller still names each part — only
   * to discover how many there are.
   */
  list(prefix: string, suffix: string): string[] {
    const found: string[] = [];
    this.zip.forEach((path, entry) => {
      if (entry.dir) return;
      const normalized = normalizePath(path);
      if (normalized.startsWith(prefix) && normalized.endsWith(suffix)) {
        found.push(normalized);
      }
    });
    return found.sort();
  }

  private entry(path: string): ZipEntry | null {
    // Some writers use backslashes in entry names; `apply-tracked-edits.ts`
    // has hit this in the wild.
    return this.zip.file(path) ?? this.zip.file(path.replace(/\//g, "\\"));
  }
}

/**
 * The uncompressed size the central directory declares.
 *
 * jszip does not expose this publicly, so it is read defensively and treated as
 * absent when the shape is not what we expect — in which case the post-inflate
 * check in `read` is the only guard, which is why that one is not optional. A
 * jszip upgrade that moves the field fails this module's tests loudly rather
 * than silently removing a defence.
 */
function uncompressedSizeOf(entry: unknown): number {
  const candidate = entry as {
    _data?: { uncompressedSize?: unknown };
  };
  const size = candidate?._data?.uncompressedSize;
  return typeof size === "number" && Number.isFinite(size) && size >= 0
    ? size
    : 0;
}

/** Entry names use forward slashes; some writers disagree. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Refuse a part that declares a DOCTYPE.
 *
 * `processEntities: true` is what makes `&amp;` and friends work, and Office
 * XML is full of them — but it is also what makes an internal entity
 * definition expand. No legitimate OOXML part has a DOCTYPE, so rejecting on
 * the declaration forecloses the whole class deterministically instead of
 * trying to bound the expansion.
 */
function assertNoDoctype(path: string, text: string): void {
  // Only the prolog can hold one, and a legitimate part's is short.
  if (/<!DOCTYPE/i.test(text.slice(0, 4096))) {
    throw new OoxmlError(`${path} declares a DOCTYPE`, "doctype");
  }
}

/**
 * A relationship target resolved against the part that referenced it.
 *
 * Targets are relative to the referencing part's folder — `slides/slide1.xml`
 * inside `ppt/_rels/presentation.xml.rels` means `ppt/slides/slide1.xml` — and
 * an absolute one is rooted at the package. Traversal is resolved rather than
 * rejected outright: `../media/x.png` is ordinary in a real deck. What keeps it
 * safe is that nothing here touches a filesystem, and the caller only reads
 * paths it recognises.
 */
export function resolveRelTarget(baseFolder: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);

  const segments = `${baseFolder}/${target}`.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join("/");
}

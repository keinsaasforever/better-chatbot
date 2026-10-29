import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "./const";

/**
 * Guards translation completeness.
 *
 * `i18n/request.ts` deep-merges every locale over `en.json`, so a key that is
 * missing from a locale silently renders in English instead of failing. That
 * makes English-only drift invisible in the product — a whole page can ship
 * untranslated without anything breaking. These tests turn that drift into a
 * failing build.
 */

const MESSAGES_DIR = join(__dirname, "../../messages");

type Messages = Record<string, unknown>;

function readLocale(locale: string): Messages {
  return JSON.parse(
    readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf8"),
  ) as Messages;
}

/** Flattens nested namespaces into `A.b.c` keys mapped to their strings. */
function flatten(messages: Messages, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") {
      for (const [k, v] of flatten(value as Messages, path)) out.set(k, v);
    } else {
      out.set(path, String(value));
    }
  }
  return out;
}

/**
 * ICU argument names used by a message.
 *
 * A regex cannot do this: literal text inside a plural branch (`other {s}`)
 * looks exactly like an argument, so walk the message and only collect names
 * that sit in true argument position.
 */
function icuArguments(message: string): Set<string> {
  const args = new Set<string>();
  const n = message.length;

  /** Consumes a message body; returns the index of its closing brace. */
  function parseBody(i: number): number {
    while (i < n && message[i] !== "}") {
      i = message[i] === "{" ? parseArgument(i + 1) : i + 1;
    }
    return i;
  }

  /** `i` points just past the opening brace; returns the index past `}`. */
  function parseArgument(i: number): number {
    let start = i;
    while (i < n && message[i] !== "," && message[i] !== "}") i++;
    args.add(message.slice(start, i).trim());
    if (message[i] === ",") {
      i++;
      start = i;
      while (i < n && message[i] !== "," && message[i] !== "}") i++;
      const kind = message.slice(start, i).trim();
      if (message[i] === ",") {
        i++;
        if (
          kind === "plural" ||
          kind === "select" ||
          kind === "selectordinal"
        ) {
          while (i < n && message[i] !== "}") {
            i = message[i] === "{" ? parseBody(i + 1) + 1 : i + 1;
          }
        } else {
          // A format style (number, date, …): skip ahead to our own brace.
          let depth = 0;
          while (i < n) {
            if (message[i] === "{") depth++;
            else if (message[i] === "}") {
              if (depth === 0) break;
              depth--;
            }
            i++;
          }
        }
      }
    }
    return i + 1;
  }

  parseBody(0);
  return args;
}

/** Rich-text tags (`<strong>`, `<code>`) the message expects a renderer for. */
function richTextTags(message: string): Set<string> {
  return new Set(
    [...message.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)>/g)].map((m) => m[1]),
  );
}

const english = flatten(readLocale("en"));
const otherLocales = SUPPORTED_LOCALES.map((l) => l.code).filter(
  (code) => code !== "en",
);

describe("locale message files", () => {
  it("ships a message file for every supported locale", () => {
    const onDisk = readdirSync(MESSAGES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    expect(onDisk).toEqual(SUPPORTED_LOCALES.map((l) => l.code).sort());
  });

  it("has at least one locale besides English to check", () => {
    expect(otherLocales.length).toBeGreaterThan(0);
  });

  describe.each(otherLocales)("%s.json", (locale) => {
    const messages = flatten(readLocale(locale));

    it("translates every key in en.json", () => {
      const missing = [...english.keys()].filter((k) => !messages.has(k));
      expect(
        missing,
        `${locale}.json is missing ${missing.length} key(s) — they would silently fall back to English. Add translations for: ${missing.slice(0, 10).join(", ")}`,
      ).toEqual([]);
    });

    it("has no keys that en.json does not define", () => {
      const extra = [...messages.keys()].filter((k) => !english.has(k));
      expect(
        extra,
        `${locale}.json defines ${extra.length} key(s) absent from en.json (likely renamed or dead): ${extra.slice(0, 10).join(", ")}`,
      ).toEqual([]);
    });

    it("leaves no message blank", () => {
      const blank = [...messages.entries()]
        .filter(([k, v]) => !v.trim() && english.get(k)?.trim())
        .map(([k]) => k);
      expect(blank).toEqual([]);
    });

    it("keeps the same ICU placeholders as en.json", () => {
      const mismatched = [...english.entries()]
        .filter(([key, source]) => {
          const translated = messages.get(key);
          if (translated === undefined) return false;
          const expected = [...icuArguments(source)].sort();
          const actual = [...icuArguments(translated)].sort();
          return expected.join("|") !== actual.join("|");
        })
        .map(([key]) => key);
      expect(
        mismatched,
        `${locale}.json has placeholder drift — next-intl throws at render time on an unknown or missing argument: ${mismatched.slice(0, 10).join(", ")}`,
      ).toEqual([]);
    });

    it("keeps the same rich-text tags as en.json", () => {
      const mismatched = [...english.entries()]
        .filter(([key, source]) => {
          const translated = messages.get(key);
          if (translated === undefined) return false;
          const expected = [...richTextTags(source)].sort();
          const actual = [...richTextTags(translated)].sort();
          return expected.join("|") !== actual.join("|");
        })
        .map(([key]) => key);
      expect(
        mismatched,
        `${locale}.json has rich-text tag drift — t.rich() throws when a tag has no renderer: ${mismatched.slice(0, 10).join(", ")}`,
      ).toEqual([]);
    });
  });
});

describe("icuArguments", () => {
  it("reads argument names", () => {
    expect(icuArguments("Invited {succeeded} · {failed} failed")).toEqual(
      new Set(["succeeded", "failed"]),
    );
  });

  it("ignores literal text inside plural branches", () => {
    expect(
      icuArguments("{count} user{count, plural, =1 {} other {s}} total"),
    ).toEqual(new Set(["count"]));
  });

  it("reads arguments around a plural", () => {
    expect(
      icuArguments(
        "{tokens} tokens across {count} model{count, plural, =1 {} other {s}} in {period}.",
      ),
    ).toEqual(new Set(["tokens", "count", "period"]));
  });

  it("finds nothing in a plain message", () => {
    expect(icuArguments("Organizations")).toEqual(new Set());
  });
});

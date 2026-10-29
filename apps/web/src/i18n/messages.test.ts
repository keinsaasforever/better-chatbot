import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "../lib/const";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import ja from "../../messages/ja.json";
import ko from "../../messages/ko.json";
import pt from "../../messages/pt.json";
import zh from "../../messages/zh.json";

const CATALOGS: Record<string, unknown> = { en, de, es, fr, ja, ko, pt, zh };

/** Every leaf key path in a message catalog, e.g. `Billing.usageLimit.title`. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

/** ICU placeholders, ignoring the format (`{used, number}` → `used`). */
function placeholders(message: string): Set<string> {
  return new Set(
    [...message.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*(?:,[^}]*)?\}/g)].map(
      (match) => match[1],
    ),
  );
}

function leaf(catalog: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) => (node as Record<string, unknown> | undefined)?.[key],
      catalog,
    );
}

// The blocks added for the usage-limit and invitation dialogs. Both are shown
// to users who may never have set a language, so an English leak is likely to
// be seen — parity here is not cosmetic.
const CRITICAL_PREFIXES = ["Billing.usageLimit.", "Invitation."];

describe("message catalogs", () => {
  it("ships a catalog for every supported locale", () => {
    for (const { code } of SUPPORTED_LOCALES) {
      expect(CATALOGS[code], `missing messages/${code}.json`).toBeDefined();
    }
  });

  const criticalKeys = keyPaths(en).filter((path) =>
    CRITICAL_PREFIXES.some((prefix) => path.startsWith(prefix)),
  );

  it("covers the dialog copy in the reference catalog", () => {
    expect(criticalKeys.length).toBeGreaterThan(0);
  });

  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    if (locale === "en") continue;

    it(`translates every blocking-dialog string in ${locale}`, () => {
      const missing = criticalKeys.filter(
        (path) => typeof leaf(catalog, path) !== "string",
      );
      expect(missing, `missing in ${locale}.json`).toEqual([]);
    });

    it(`introduces no rich-text tag ${locale} cannot render`, () => {
      // `t.rich` throws when a message carries a tag the caller did not supply,
      // so a tag a translator invented is a runtime crash, not a typo.
      const stray = criticalKeys.filter((path) => {
        const source = leaf(en, path);
        const target = leaf(catalog, path);
        if (typeof source !== "string" || typeof target !== "string") {
          return false;
        }
        const allowed = new Set(
          [...source.matchAll(/<([a-zA-Z0-9]+)>/g)].map((m) => m[1]),
        );
        return [...target.matchAll(/<([a-zA-Z0-9]+)>/g)].some(
          (m) => !allowed.has(m[1]),
        );
      });
      expect(stray, `unsupported tag in ${locale}.json`).toEqual([]);
    });

    it(`keeps the same ICU placeholders in ${locale}`, () => {
      const mismatched = criticalKeys.filter((path) => {
        const source = leaf(en, path);
        const target = leaf(catalog, path);
        if (typeof source !== "string" || typeof target !== "string") {
          return false;
        }
        const expected = [...placeholders(source)].sort();
        const actual = [...placeholders(target)].sort();
        return expected.join() !== actual.join();
      });
      expect(mismatched, `placeholder drift in ${locale}.json`).toEqual([]);
    });
  }
});

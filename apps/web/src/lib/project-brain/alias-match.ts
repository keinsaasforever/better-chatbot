/**
 * Cross-source entity resolution without an LLM: decides whether a freshly
 * extracted entity is the same thing as an existing page whose aliases are
 * close but not identical. Conservative by design: an ambiguous match (two
 * different pages qualify) returns null and a new page is created; the
 * nightly dedupe gets a second, model-assisted chance.
 */

export type AliasCandidate = {
  pageId: string;
  normalizedAlias: string;
  email?: string | null;
  domain?: string | null;
};

export type AliasMatch = {
  pageId: string;
  reason: "email" | "domain" | "token_subset";
};

const LEGAL_SUFFIXES = new Set([
  "gmbh",
  "ag",
  "ug",
  "kg",
  "ohg",
  "oü",
  "ou",
  "as",
  "ab",
  "ltd",
  "limited",
  "inc",
  "llc",
  "corp",
  "co",
  "plc",
  "sa",
  "sarl",
  "bv",
  "nv",
  "spa",
  "srl",
  "de",
  "com",
  "io",
  "net",
  "org",
  "www",
  "the",
]);

const PERSON_TITLES = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "herr",
  "frau",
  "sir",
]);

export function normalizeAliasText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function emailDomain(email: string | null | undefined) {
  const at = (email ?? "").trim().toLowerCase().lastIndexOf("@");
  return at > 0
    ? (email as string)
        .trim()
        .toLowerCase()
        .slice(at + 1)
    : null;
}

export function normalizeDomain(value: string | null | undefined) {
  if (!value) return null;
  const lowered = value.trim().toLowerCase();
  const stripped = lowered
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  return stripped || null;
}

export function tokenize(value: string, entityType: string): string[] {
  const drop = entityType === "person" ? PERSON_TITLES : LEGAL_SUFFIXES;
  return normalizeAliasText(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !drop.has(token));
}

/**
 * True when every token of the shorter name appears in the longer one. Equal
 * token sets count too: the exact-alias lookup already missed, so the names
 * differ only by titles or legal suffixes ("Dr. Paul Müller", "Moebel.de GmbH").
 */
function tokenSubset(a: string[], b: string[]) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!short.length) return false;
  const set = new Set(long);
  if (short.length === long.length) {
    return short.every((token) => set.has(token));
  }
  if (long.length < 2) return false;
  return short.every((token) => set.has(token));
}

export function matchAlias(
  entity: {
    entityType: string;
    title: string;
    aliases?: string[];
    email?: string | null;
    domain?: string | null;
  },
  candidates: AliasCandidate[],
): AliasMatch | null {
  if (!candidates.length) return null;

  const email = entity.email?.trim().toLowerCase() || null;
  const domain =
    normalizeDomain(entity.domain) ??
    (entity.entityType === "organization" ? emailDomain(email) : null);

  const byReason = (
    reason: AliasMatch["reason"],
    predicate: (candidate: AliasCandidate) => boolean,
  ): AliasMatch | null => {
    const pageIds = new Set(
      candidates.filter(predicate).map((candidate) => candidate.pageId),
    );
    if (pageIds.size !== 1) return null;
    return { pageId: [...pageIds][0], reason };
  };

  if (email) {
    const hit = byReason(
      "email",
      (candidate) => (candidate.email ?? "").trim().toLowerCase() === email,
    );
    if (hit) return hit;
  }

  if (domain && entity.entityType === "organization") {
    const hit = byReason(
      "domain",
      (candidate) => normalizeDomain(candidate.domain) === domain,
    );
    if (hit) return hit;
  }

  if (entity.entityType !== "person" && entity.entityType !== "organization") {
    return null;
  }

  const names = [entity.title, ...(entity.aliases ?? [])];
  const tokenSets = names
    .map((name) => tokenize(name, entity.entityType))
    .filter((tokens) => tokens.length > 0);

  // A single short token ("paul") only matches when it is not a generic word;
  // require at least 3 characters, and for organizations at least 5.
  const minSingleToken = entity.entityType === "person" ? 3 : 5;

  return byReason("token_subset", (candidate) => {
    const candidateTokens = tokenize(
      candidate.normalizedAlias,
      entity.entityType,
    );
    return tokenSets.some((tokens) => {
      const shorter =
        tokens.length <= candidateTokens.length ? tokens : candidateTokens;
      if (shorter.length === 1 && shorter[0].length < minSingleToken) {
        return false;
      }
      return tokenSubset(tokens, candidateTokens);
    });
  });
}

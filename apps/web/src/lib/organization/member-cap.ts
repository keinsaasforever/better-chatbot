/**
 * Shared defaults for per-member AI spending caps.
 *
 * Caps are stored in "micros" — the same unit the AI-policy tables and the
 * model router (`lib/ai/routing/budget.ts`) use. 1_000_000 micros = €1.
 *
 * Product rule: an org admin manages billing for the whole workspace and each
 * invited employee ("member") gets a €15 allowance by default. The allowance is
 * a fixed total, not a monthly budget: it does not refill, only an admin raising
 * the limit grants more (see `getMemberSpentMicros` in the model router).
 * Org owners (the billing manager) and solo users in their personal workspace
 * are never capped by default.
 */
export const DEFAULT_MEMBER_MONTHLY_CAP_MICROS = 15_000_000;

/** micros → euros as a fixed 2-decimal string, e.g. 15_000_000 → "15.00". */
export function microsToEuroString(micros: number): string {
  return (micros / 1_000_000).toFixed(2);
}

/** A personal "Workspace" org is flagged via `metadata.personal === true`. */
export function isPersonalOrgMetadata(
  metadata: string | null | undefined,
): boolean {
  if (!metadata) return false;
  try {
    return JSON.parse(metadata as string)?.personal === true;
  } catch {
    return false;
  }
}

/**
 * Default cap (micros) to show/enforce for a member that has no
 * explicit `member_ai_policy` row yet. Team members default to €15 in total; owners and
 * members of a personal workspace have no default cap.
 */
export function defaultMemberCapMicros(input: {
  role: string;
  orgIsPersonal: boolean;
}): number | null {
  if (input.orgIsPersonal) return null;
  if (input.role === "owner") return null;
  return DEFAULT_MEMBER_MONTHLY_CAP_MICROS;
}

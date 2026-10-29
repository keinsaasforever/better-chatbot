import type { z } from "zod";
import type { CockpitProvider, Feed } from "../types";

export type ProbeResult = { ok: true } | { ok: false; reason: string };

export type ProviderContext = {
  /** Aborts every outbound request once the provider's deadline passes. */
  signal: AbortSignal;
  /** Stable id of the stored connection (absent for an unsaved test). */
  connectionId?: string;
  /** Changes whenever the stored config changes; busts per-connection caches. */
  version?: string;
  /**
   * Owner and workspace of the connection. Providers that use an MCP server
   * connected in Navigator resolve it with this identity, under the usual
   * MCP server access rule.
   */
  scope?: { userId: string; organizationId: string | null };
};

export type CockpitProviderModule<C, D> = {
  provider: CockpitProvider;
  configSchema: z.ZodType<C>;
  /** Total time budget for one probe or fetch. */
  deadlineMs: number;
  probe(config: C, ctx: ProviderContext): Promise<ProbeResult>;
  fetch(config: C, ctx: ProviderContext): Promise<Feed<D>>;
  /**
   * Runs once on save, before validation, to turn transient input into
   * stored config (Revolut: authorization code → refresh token). Returns a
   * reason instead of throwing.
   */
  prepare?(
    raw: Record<string, unknown>,
    ctx: ProviderContext,
  ): Promise<
    | { ok: true; config: Record<string, unknown> }
    | { ok: false; reason: string }
  >;
};

export const live = <T>(data: T): Feed<T> => ({
  status: "live",
  data,
  updatedAt: new Date().toISOString(),
});

export const inop = <T>(reason: string): Feed<T> => ({
  status: "inop",
  reason,
});

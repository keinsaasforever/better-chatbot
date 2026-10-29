"use client";

import type { CockpitProvider } from "lib/cockpit/types";
import { fetcher } from "lib/utils";
import useSWR from "swr";

export type CockpitConnectionItem = {
  id: string;
  provider: CockpitProvider;
  label: string | null;
  enabled: boolean;
  lastOkAt: string | null;
  lastError: string | null;
  updatedAt: string;
  config: { values: Record<string, unknown>; secretsSet: string[] };
};

export type CockpitScopeSummary = {
  workspace: string | null;
  elsewhere: Array<{ workspace: string | null; count: number }>;
};

type ConnectionsResponse = {
  connections: CockpitConnectionItem[];
  canManage: boolean;
  secretsAvailable: boolean;
  scope: CockpitScopeSummary | null;
};

export type ConnectionMutationResult =
  | { ok: true }
  | { ok: false; reason: string | null; issues?: string[] };

async function send(
  url: string,
  init: RequestInit,
): Promise<ConnectionMutationResult & { body?: any }> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      reason: body?.reason ?? body?.detail ?? null,
      issues: body?.issues,
    };
  }
  return { ok: true, body };
}

/** The scope's cockpit connections (secrets redacted by the API). */
export function useCockpitConnections(enabled = true) {
  const { data, error, isLoading, mutate } = useSWR<ConnectionsResponse>(
    enabled ? "/api/cockpit/connections" : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  return {
    connections: data?.connections ?? [],
    canManage: data?.canManage ?? false,
    secretsAvailable: data?.secretsAvailable ?? true,
    scope: data?.scope ?? null,
    isLoading,
    error,
    mutate,
    async save(
      provider: CockpitProvider,
      config: Record<string, unknown>,
    ): Promise<ConnectionMutationResult> {
      const result = await send("/api/cockpit/connections", {
        method: "POST",
        body: JSON.stringify({ provider, config }),
      });
      await mutate();
      return result;
    },
    async remove(id: string): Promise<ConnectionMutationResult> {
      const result = await send(
        `/api/cockpit/connections?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      await mutate();
      return result;
    },
    async test(
      input:
        | { id: string }
        | { provider: CockpitProvider; config: Record<string, unknown> },
    ): Promise<ConnectionMutationResult> {
      const result = await send("/api/cockpit/connections/test", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (result.ok && result.body && result.body.ok === false) {
        return { ok: false, reason: result.body.detail ?? null };
      }
      if ("id" in input) await mutate();
      return result.ok ? { ok: true } : result;
    },
  };
}

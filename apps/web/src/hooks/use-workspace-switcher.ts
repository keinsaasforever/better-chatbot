"use client";

import { authClient } from "auth/client";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

/**
 * Every workspace the user belongs to (personal + team orgs), plus the switch
 * action.
 *
 * Shared by the sidebar menu and the usage-limit dialog — the latter needs it
 * because a user whose active workspace is over its limit would otherwise have
 * no reachable way to move to one that still has credits.
 *
 * The SWR key is a literal so both call sites share one cache entry and one
 * `organization.list()` request.
 */
export function useWorkspaceSwitcher(activeOrganizationId?: string) {
  const t = useTranslations("Layout");
  const [isSwitching, setIsSwitching] = useState(false);

  const { data: organizations } = useSWR("user-organizations", async () => {
    const { data } = await authClient.organization.list();
    return data ?? [];
  });

  const switchWorkspace = useCallback(
    async (organizationId: string) => {
      if (organizationId === activeOrganizationId) return;
      setIsSwitching(true);
      try {
        const { error } = await authClient.organization.setActive({
          organizationId,
        });
        if (error) {
          toast.error(error.message || t("switchWorkspaceFailed"));
          setIsSwitching(false);
          return;
        }
        // Billing context, org-scoped agents/workflows/MCP lists and server
        // components all key off the session's active org; a full reload is
        // the only way to drop every client and server cache at once.
        window.location.reload();
      } catch {
        toast.error(t("switchWorkspaceFailed"));
        setIsSwitching(false);
      }
    },
    [activeOrganizationId, t],
  );

  return { organizations, isSwitching, switchWorkspace };
}

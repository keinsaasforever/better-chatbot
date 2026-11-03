"use client";

import { Building2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { DropdownMenuItem } from "ui/dropdown-menu";

import { appStore } from "@/app/store";
import { useUpdateSetupUrl } from "./updates";

/**
 * Community implementation of the client-side edition seam.
 *
 * Team workspaces and billing are part of the hosted product. The exports
 * mirror the cloud module so consumers never branch on the edition
 * themselves.
 */

/**
 * An account owns its single personal workspace. "Create Organization" stays
 * in the menu, as in the hosted product, but opens the Teams plan pitch
 * (`TeamsPlanDialog` in ./popups) instead of creating one. The dialog is
 * opened through the store because it must outlive this menu, which unmounts
 * its content as soon as it closes.
 */
export function WorkspaceMenuSection() {
  const tOrg = useTranslations("Organization");
  const tUpdates = useTranslations("Updates");
  const updateSetupUrl = useUpdateSetupUrl();
  return (
    <>
      <DropdownMenuItem
        className="cursor-pointer"
        onClick={() => appStore.setState({ openTeamsPlan: true })}
        data-testid="create-organization-menu-item"
      >
        <Building2 className="size-4 text-foreground" />
        <span>{tOrg("createOrganization")}</span>
      </DropdownMenuItem>
      {updateSetupUrl && (
        <DropdownMenuItem asChild className="cursor-pointer">
          <a href={updateSetupUrl} target="_blank" rel="noopener noreferrer">
            <RefreshCw className="size-4 text-foreground" />
            <span>{tUpdates("menuItem")}</span>
          </a>
        </DropdownMenuItem>
      )}
    </>
  );
}

/** Nothing to bill. */
export function BillingMenuItem() {
  return null;
}

/** Local models are included in this edition; there is nothing to buy. */
export function useLocalModelsCheckout(): {
  canSubscribe: boolean;
  subscribe: () => Promise<void>;
} {
  return {
    canSubscribe: false,
    subscribe: async () => {},
  };
}

/**
 * Referral credits are part of the hosted product, so the entry points never
 * show here. Mirrors the cloud export so consumers stay edition-agnostic.
 */
export function ReferralEnabledProvider({
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

export function useReferralEnabled(): boolean {
  return false;
}

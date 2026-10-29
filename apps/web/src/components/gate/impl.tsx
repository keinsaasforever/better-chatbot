"use client";

/**
 * Community implementation of the client-side edition seam.
 *
 * Team workspaces and billing are part of the hosted product, so every
 * surface here renders nothing. The exports mirror the cloud module so
 * consumers never branch on the edition themselves.
 */

/** No workspace switching: an account owns its single personal workspace. */
export function WorkspaceMenuSection() {
  return null;
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

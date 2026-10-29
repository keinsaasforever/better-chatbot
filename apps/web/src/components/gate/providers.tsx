import type { BasicUser } from "app-types/user";

/**
 * Community build: no billing context, usage nudge or onboarding tour, so the
 * shell is rendered unchanged.
 */
export async function CloudProviders({
  children,
}: {
  user: BasicUser;
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

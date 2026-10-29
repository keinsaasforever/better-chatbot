import SignUpPage from "@/components/auth/sign-up";
import { getAuthConfig } from "auth/config";
import { callbackUrlQuery, sanitizeCallbackUrl } from "lib/auth/callback-url";
import { getIsFirstUser } from "lib/auth/server";
import { redirect } from "next/navigation";

export default async function SignUp({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const isFirstUser = await getIsFirstUser();
  const callbackUrl = sanitizeCallbackUrl((await searchParams).callbackUrl);
  const {
    emailAndPasswordEnabled,
    socialAuthenticationProviders,
    signUpEnabled,
  } = getAuthConfig();

  if (!signUpEnabled) {
    // Keep the callback (an invitation, or the desktop handoff) through the
    // bounce to sign-in.
    redirect(`/sign-in${callbackUrlQuery(callbackUrl)}`);
  }
  const enabledProviders = (
    Object.keys(
      socialAuthenticationProviders,
    ) as (keyof typeof socialAuthenticationProviders)[]
  ).filter((key) => socialAuthenticationProviders[key]);
  return (
    <SignUpPage
      isFirstUser={isFirstUser}
      emailAndPasswordEnabled={emailAndPasswordEnabled}
      socialAuthenticationProviders={enabledProviders}
      callbackUrl={callbackUrl}
    />
  );
}

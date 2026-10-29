import SignIn from "@/components/auth/sign-in";
import { logBootServerRender } from "@/lib/boot-diagnostics/server";
import { sanitizeCallbackUrl } from "lib/auth/callback-url";
import { getAuthConfig } from "lib/auth/config";
import { getIsFirstUser } from "lib/auth/server";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  await logBootServerRender("/sign-in");
  const isFirstUser = await getIsFirstUser();
  const callbackUrl = sanitizeCallbackUrl((await searchParams).callbackUrl);
  const {
    emailAndPasswordEnabled,
    signUpEnabled,
    socialAuthenticationProviders,
  } = getAuthConfig();
  const enabledProviders = (
    Object.keys(
      socialAuthenticationProviders,
    ) as (keyof typeof socialAuthenticationProviders)[]
  ).filter((key) => socialAuthenticationProviders[key]);
  return (
    <SignIn
      emailAndPasswordEnabled={emailAndPasswordEnabled}
      signUpEnabled={signUpEnabled}
      socialAuthenticationProviders={enabledProviders}
      isFirstUser={isFirstUser}
      callbackUrl={callbackUrl}
    />
  );
}

import EmailSignUp from "@/components/auth/email-sign-up";
import { sanitizeCallbackUrl } from "lib/auth/callback-url";
import { getIsFirstUser } from "lib/auth/server";

export default async function EmailSignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const isFirstUser = await getIsFirstUser();
  const callbackUrl = sanitizeCallbackUrl((await searchParams).callbackUrl);
  return <EmailSignUp isFirstUser={isFirstUser} callbackUrl={callbackUrl} />;
}

import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "ui/button";
import { getAuthConfig } from "auth/config";

export default async function SignUpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations();
  const { signUpEnabled } = getAuthConfig();

  // Only show sign-in button if sign-up is enabled
  // We don't need to check isFirstUser here since the sign-up page already does it
  // and the first user always needs to sign up anyway
  return (
    <div className="animate-in fade-in duration-1000 w-full h-full flex flex-col p-4 md:p-8 justify-center relative">
      <div className="w-full flex justify-end absolute top-0 right-0">
        {signUpEnabled && (
          <Link href="/sign-in">
            <Button variant="ghost">{t("Auth.SignUp.signIn")}</Button>
          </Link>
        )}
      </div>
      <div className="flex flex-col gap-4 w-full md:max-w-md mx-auto">
        {children}
      </div>
    </div>
  );
}

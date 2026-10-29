import { Button } from "../ui/button";
import { SocialAuthenticationProvider } from "app-types/authentication";
import { GoogleIcon } from "ui/google-icon";
import { GithubIcon } from "ui/github-icon";
import { MicrosoftIcon } from "ui/microsoft-icon";
import { cn } from "lib/utils";

export default function SocialProviders({
  socialAuthenticationProviders,
  onSocialProviderClick,
  className,
}: {
  socialAuthenticationProviders: SocialAuthenticationProvider[];
  onSocialProviderClick: (provider: SocialAuthenticationProvider) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 w-full", className)}>
      {socialAuthenticationProviders.includes("google") && (
        <Button
          variant="outline"
          onClick={() => onSocialProviderClick("google")}
          className="flex-1 w-full"
          data-testid="google-signup-button"
        >
          <GoogleIcon className="size-4 fill-foreground" />
          Google
        </Button>
      )}
      {socialAuthenticationProviders.includes("github") && (
        <Button
          variant="outline"
          onClick={() => onSocialProviderClick("github")}
          className="flex-1 w-full"
          data-testid="github-signup-button"
        >
          <GithubIcon className="size-4 fill-foreground" />
          GitHub
        </Button>
      )}
      {socialAuthenticationProviders.includes("microsoft") && (
        <Button
          variant="outline"
          onClick={() => onSocialProviderClick("microsoft")}
          className="flex-1 w-full"
          data-testid="microsoft-signup-button"
        >
          <MicrosoftIcon className="size-4 fill-foreground" />
          Microsoft
        </Button>
      )}
    </div>
  );
}

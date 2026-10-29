import { redirect } from "next/navigation";
import { getSession } from "lib/auth/server";
import { userRepository } from "lib/db/repository";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }

  const preferences = await userRepository.getPreferences(session.user.id);

  if (preferences?.onboarding?.step === "done") {
    // Redirect through the Route Handler which sets the cookie server-side
    // before going to /. This breaks the middleware redirect loop that occurs
    // when the cookie was cleared (cache wipe, new device, incognito, etc.).
    // Cookies cannot be set in Server Components — only in Route Handlers.
    redirect("/api/onboarding/complete");
  }

  const currentStep = preferences?.onboarding?.step ?? "automation_overview";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <OnboardingWizard initialStep={currentStep} />
    </div>
  );
}

import { getSession } from "auth/server";
import { redirect } from "next/navigation";
import SlackIntegrationSettings from "@/components/slack/slack-integration-settings";

// Session-dependent page — never statically generated.
export const dynamic = "force-dynamic";

export default async function SlackIntegrationPage() {
  const session = await getSession();
  if (!session?.user) {
    return redirect("/sign-in");
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <SlackIntegrationSettings />
    </div>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CockpitShell } from "@/components/cockpit/cockpit-shell";
import { getSession } from "@/lib/auth/server";
import { getCockpitData } from "@/lib/cockpit/feeds";

// Live instruments: every request reads the (60 s cached) feeds for the
// viewer's own scope, so the page must never be statically rendered.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Cockpit");
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    robots: { index: false, follow: false },
  };
}

export default async function CockpitPage() {
  // The (chat) layout already redirects signed-out users; the session is
  // read again here because the feeds are scoped to it.
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const data = await getCockpitData({
    userId: session.user.id,
    organizationId: session.session.activeOrganizationId ?? null,
  });

  // Set by the marketing site's `?ks_internal=1`; usually absent on this
  // domain, and then the LED stays off.
  const internalTraffic = (await cookies()).get("ks_internal")?.value === "1";

  return <CockpitShell data={data} internalTraffic={internalTraffic} />;
}

import { getSession } from "auth/server";
import { redirect } from "next/navigation";
import { workflowRepository } from "lib/db/repository";
import { WorkflowIndex } from "@/components/workflow/workflow-index";

// Session-dependent, so it cannot be statically generated.
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }

  const activeOrganizationId = (
    session.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;
  const workflows = await workflowRepository.selectAll(
    session.user.id,
    activeOrganizationId,
  );

  return <WorkflowIndex workflows={workflows} />;
}

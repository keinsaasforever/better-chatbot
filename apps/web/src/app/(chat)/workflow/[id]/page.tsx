import {
  convertDBEdgeToUIEdge,
  convertDBNodeToUINode,
} from "lib/ai/workflow/shared.workflow";
import Workflow from "@/components/workflow/workflow";
import { getSession } from "auth/server";
import { workflowRepository } from "lib/db/repository";
import { notFound, redirect } from "next/navigation";

export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  if (!session) {
    redirect("/sign-in");
  }

  const activeOrganizationId = (
    session.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;
  const hasAccess = await workflowRepository.checkAccess(
    id,
    session.user.id,
    true,
    activeOrganizationId,
  );
  if (!hasAccess) {
    notFound();
  }

  const workflow = await workflowRepository.selectStructureById(id);
  if (!workflow) {
    notFound();
  }
  const hasEditAccess = await workflowRepository.checkAccess(
    id,
    session.user.id,
    false,
    activeOrganizationId,
  );
  const initialNodes = workflow.nodes.map(convertDBNodeToUINode);
  const initialEdges = workflow.edges.map(convertDBEdgeToUIEdge);
  return (
    <Workflow
      key={id}
      workflowId={id}
      initialNodes={initialNodes}
      initialEdges={initialEdges}
      hasEditAccess={hasEditAccess}
    />
  );
}

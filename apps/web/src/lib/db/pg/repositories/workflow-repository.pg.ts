import { and, desc, eq, inArray, not, or, sql } from "drizzle-orm";
import { pgDb } from "../db.pg";
import {
  UserTable,
  WorkflowEdgeTable,
  WorkflowNodeDataTable,
  WorkflowTable,
} from "../schema.pg";
import {
  DBWorkflow,
  DBEdge,
  DBNode,
  WorkflowRepository,
  WorkflowSummary,
} from "app-types/workflow";
import { NodeKind } from "lib/ai/workflow/workflow.interface";
import { createUINode } from "lib/ai/workflow/create-ui-node";
import {
  convertUINodeToDBNode,
  defaultObjectJsonSchema,
} from "lib/ai/workflow/shared.workflow";
import { ObjectJsonSchema7 } from "app-types/util";

export const pgWorkflowRepository: WorkflowRepository = {
  async selectToolByIds(ids) {
    if (!ids.length) return [];
    const rows = await pgDb
      .select({
        id: WorkflowTable.id,
        name: WorkflowTable.name,
        description: WorkflowTable.description,
        schema: WorkflowNodeDataTable.nodeConfig,
      })
      .from(WorkflowTable)
      .innerJoin(
        WorkflowNodeDataTable,
        and(
          eq(WorkflowNodeDataTable.workflowId, WorkflowTable.id),
          eq(WorkflowNodeDataTable.kind, NodeKind.Input),
        ),
      )
      .where(
        and(
          inArray(WorkflowTable.id, ids),
          eq(WorkflowTable.isPublished, true),
        ),
      );
    return rows.map(
      (data) =>
        ({
          ...data,
          schema:
            data.schema?.outputSchema ||
            structuredClone(defaultObjectJsonSchema),
        }) as {
          id: string;
          name: string;
          description?: string;
          schema: ObjectJsonSchema7;
        },
    );
  },

  async selectExecuteAbility(userId, activeOrganizationId) {
    // Published workflows the caller can run: own ones, plus shared
    // (non-private) ones in the caller's active org. Without an active org the
    // shared branch is dropped, so only own workflows are returned (fails
    // closed).
    const shared = activeOrganizationId
      ? and(
          not(eq(WorkflowTable.visibility, "private")),
          eq(WorkflowTable.organizationId, activeOrganizationId),
        )
      : undefined;
    const rows = await pgDb
      .select({
        id: WorkflowTable.id,
        name: WorkflowTable.name,
        description: WorkflowTable.description,
        icon: WorkflowTable.icon,
        visibility: WorkflowTable.visibility,
        isPublished: WorkflowTable.isPublished,
        userId: WorkflowTable.userId,
        userName: UserTable.name,
        userAvatar: UserTable.image,
        updatedAt: WorkflowTable.updatedAt,
      })
      .from(WorkflowTable)
      .innerJoin(UserTable, eq(WorkflowTable.userId, UserTable.id))
      .where(
        and(
          eq(WorkflowTable.isPublished, true),
          shared
            ? or(eq(WorkflowTable.userId, userId), shared)
            : eq(WorkflowTable.userId, userId),
        ),
      );
    return rows as WorkflowSummary[];
  },
  async selectAll(userId, activeOrganizationId) {
    // Own workflows plus shared (public/readonly) workflows in the caller's
    // active org. Without an active org the shared branch is dropped, so the
    // result is owner-only (fails closed).
    const shared = activeOrganizationId
      ? and(
          inArray(WorkflowTable.visibility, ["public", "readonly"]),
          eq(WorkflowTable.organizationId, activeOrganizationId),
        )
      : undefined;
    const rows = await pgDb
      .select({
        id: WorkflowTable.id,
        name: WorkflowTable.name,
        description: WorkflowTable.description,
        icon: WorkflowTable.icon,
        visibility: WorkflowTable.visibility,
        isPublished: WorkflowTable.isPublished,
        userId: WorkflowTable.userId,
        userName: UserTable.name,
        userAvatar: UserTable.image,
        updatedAt: WorkflowTable.updatedAt,
      })
      .from(WorkflowTable)
      .innerJoin(UserTable, eq(WorkflowTable.userId, UserTable.id))
      .where(
        shared
          ? or(eq(WorkflowTable.userId, userId), shared)
          : eq(WorkflowTable.userId, userId),
      )
      .orderBy(desc(WorkflowTable.createdAt));
    return rows as WorkflowSummary[];
  },
  async selectById(id) {
    const [workflow] = await pgDb
      .select()
      .from(WorkflowTable)
      .where(eq(WorkflowTable.id, id));
    return workflow as DBWorkflow;
  },

  async checkAccess(workflowId, userId, readOnly = true, activeOrganizationId) {
    const [workflow] = await pgDb
      .select({
        visibility: WorkflowTable.visibility,
        userId: WorkflowTable.userId,
        organizationId: WorkflowTable.organizationId,
      })
      .from(WorkflowTable)
      .where(and(eq(WorkflowTable.id, workflowId)));
    if (!workflow) {
      return false;
    }
    if (userId == workflow.userId) return true;
    if (workflow.visibility === "private") {
      return false;
    }
    // Shared (public/readonly) access only within the caller's active org. A
    // null active org or a null/foreign workflow org fails closed.
    if (
      !activeOrganizationId ||
      workflow.organizationId !== activeOrganizationId
    )
      return false;
    if (workflow.visibility == "readonly" && !readOnly) return false;
    return true;
  },
  async delete(id) {
    const result = await pgDb
      .delete(WorkflowTable)
      .where(eq(WorkflowTable.id, id))
      .returning();
    if (result.length === 0) {
      throw new Error("Workflow not found");
    }
  },
  async selectByUserId(userId) {
    const rows = await pgDb
      .select()
      .from(WorkflowTable)
      .where(eq(WorkflowTable.userId, userId))
      .orderBy(desc(WorkflowTable.createdAt));
    return rows as DBWorkflow[];
  },
  async save(workflow, noGenerateInputNode = false) {
    const prev = workflow.id
      ? await pgDb
          .select({ id: WorkflowTable.id })
          .from(WorkflowTable)
          .where(eq(WorkflowTable.id, workflow.id))
      : null;
    const isNew = !prev;
    const [row] = await pgDb
      .insert(WorkflowTable)
      .values(workflow)
      .onConflictDoUpdate({
        target: [WorkflowTable.id],
        set: {
          ...workflow,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (isNew && !noGenerateInputNode) {
      const startNode = createUINode(NodeKind.Input);
      await pgDb.insert(WorkflowNodeDataTable).values({
        ...convertUINodeToDBNode(row.id, startNode),
        name: "INPUT",
      });
    }

    return row as DBWorkflow;
  },
  async saveStructure({ workflowId, nodes, edges, deleteNodes, deleteEdges }) {
    await pgDb.transaction(async (tx) => {
      const deletePromises: Promise<any>[] = [];
      if (deleteNodes?.length) {
        const deleteNodePromises = tx
          .delete(WorkflowNodeDataTable)
          .where(
            and(
              eq(WorkflowNodeDataTable.workflowId, workflowId),
              inArray(WorkflowNodeDataTable.id, deleteNodes),
            ),
          );
        deletePromises.push(deleteNodePromises);
      }
      if (deleteEdges?.length) {
        const deleteEdgePromises = tx
          .delete(WorkflowEdgeTable)
          .where(
            and(
              eq(WorkflowEdgeTable.workflowId, workflowId),
              inArray(WorkflowEdgeTable.id, deleteEdges),
            ),
          );
        deletePromises.push(deleteEdgePromises);
      }
      await Promise.all(deletePromises);
      if (nodes?.length) {
        await tx
          .insert(WorkflowNodeDataTable)
          .values(nodes)
          .onConflictDoUpdate({
            target: [WorkflowNodeDataTable.id],
            set: {
              nodeConfig: sql.raw(
                `excluded.${WorkflowNodeDataTable.nodeConfig.name}`,
              ),
              uiConfig: sql.raw(
                `excluded.${WorkflowNodeDataTable.uiConfig.name}`,
              ),
              name: sql.raw(`excluded.${WorkflowNodeDataTable.name.name}`),
              description: sql.raw(
                `excluded.${WorkflowNodeDataTable.description.name}`,
              ),
              kind: sql.raw(`excluded.${WorkflowNodeDataTable.kind.name}`),
              updatedAt: new Date(),
            },
          });
      }
      if (edges?.length) {
        await tx.insert(WorkflowEdgeTable).values(edges).onConflictDoNothing();
      }
    });
  },
  async selectStructureById(id, opt) {
    const [workflow] = await pgDb
      .select()
      .from(WorkflowTable)
      .where(eq(WorkflowTable.id, id));

    if (!workflow) return null;

    const nodeWhere = opt?.ignoreNote
      ? and(
          eq(WorkflowNodeDataTable.workflowId, id),
          not(eq(WorkflowNodeDataTable.kind, NodeKind.Note)),
        )
      : eq(WorkflowNodeDataTable.workflowId, id);

    const nodePromises = pgDb
      .select()
      .from(WorkflowNodeDataTable)
      .where(nodeWhere);
    const edgePromises = pgDb
      .select()
      .from(WorkflowEdgeTable)
      .where(eq(WorkflowEdgeTable.workflowId, id));
    const [nodes, edges] = await Promise.all([nodePromises, edgePromises]);
    return {
      ...(workflow as DBWorkflow),
      nodes: nodes as DBNode[],
      edges: edges as DBEdge[],
    };
  },
};

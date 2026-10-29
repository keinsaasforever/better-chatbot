import {
  ChatExport,
  ChatExportCommentWithUser,
  ChatExportCreateSchema,
  ChatExportRepository,
  ChatExportSummary,
  ChatExportWithUser,
} from "app-types/chat-export";
import { pgDb } from "../db.pg";
import {
  ChatExportCommentTable,
  ChatExportTable,
  UserTable,
} from "../schema.pg";
import { and, count, eq, sql } from "drizzle-orm";
import z from "zod";
import { pgChatRepository } from "./chat-repository.pg";

function toChatExport(data: typeof ChatExportTable.$inferSelect): ChatExport {
  return {
    id: data.id,
    exporterId: data.exporterId,
    title: data.title,
    messages: data.messages,
    originalThreadId: data.originalThreadId ?? undefined,
    exportedAt: data.exportedAt,
    expiresAt: data.expiresAt ?? undefined,
  };
}

function toChatExportInsert(
  data: z.infer<typeof ChatExportCreateSchema>,
): typeof ChatExportTable.$inferInsert {
  return ChatExportCreateSchema.parse(data) as ChatExport;
}

export const pgChatExportRepository: ChatExportRepository = {
  exportChat: async ({ threadId, exporterId, expiresAt }) => {
    const [thread, messages] = await Promise.all([
      pgChatRepository.selectThread(threadId),
      pgChatRepository.selectMessagesByThreadId(threadId),
    ]);

    if (!thread) {
      throw new Error("Thread not found");
    }

    return await pgChatExportRepository.insert({
      exporterId: exporterId ?? thread.userId,
      title: thread.title,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        parts: m.parts,
        metadata: m.metadata,
      })),
      originalThreadId: threadId,
      expiresAt,
    });
  },

  insert: async (data) => {
    const result = await pgDb
      .insert(ChatExportTable)
      .values(toChatExportInsert(data))
      .returning();
    return result[0].id;
  },
  selectById: async (id) => {
    const [result] = await pgDb
      .select()
      .from(ChatExportTable)
      .where(eq(ChatExportTable.id, id));
    return toChatExport(result);
  },
  selectByIdWithUser: async (id) => {
    const [result] = await pgDb
      .select({
        id: ChatExportTable.id,
        title: ChatExportTable.title,
        exporterId: ChatExportTable.exporterId,
        messages: ChatExportTable.messages,
        exportedAt: ChatExportTable.exportedAt,
        expiresAt: ChatExportTable.expiresAt,
        originalThreadId: ChatExportTable.originalThreadId,
        exporterName: UserTable.name,
        exporterImage: UserTable.image,
      })
      .from(ChatExportTable)
      .leftJoin(UserTable, eq(ChatExportTable.exporterId, UserTable.id))
      .where(eq(ChatExportTable.id, id));
    return result as ChatExportWithUser;
  },
  selectByExporterId: async (exporterId) => {
    const result = await pgDb
      .select()
      .from(ChatExportTable)
      .where(eq(ChatExportTable.exporterId, exporterId));
    return result.map(toChatExport);
  },
  selectSummaryByExporterId: async (exporterId) => {
    const result = await pgDb
      .select({
        id: ChatExportTable.id,
        title: ChatExportTable.title,
        exporterId: ChatExportTable.exporterId,
        originalThreadId: ChatExportTable.originalThreadId,
        exportedAt: ChatExportTable.exportedAt,
        expiresAt: ChatExportTable.expiresAt,
        commentCount: count(ChatExportCommentTable.id),
      })
      .from(ChatExportTable)
      .leftJoin(
        ChatExportCommentTable,
        eq(ChatExportCommentTable.exportId, ChatExportTable.id),
      )
      .where(eq(ChatExportTable.exporterId, exporterId))
      .groupBy(ChatExportTable.id)
      .orderBy(sql`${ChatExportTable.exportedAt} DESC`);

    return result.map((row) => ({
      ...row,
      originalThreadId: row.originalThreadId ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
      commentCount: Number(row.commentCount) || 0,
    })) as ChatExportSummary[];
  },
  checkAccess: async (id, userId) => {
    const result = await pgDb
      .select({
        exporterId: ChatExportTable.exporterId,
      })
      .from(ChatExportTable)
      .where(
        and(eq(ChatExportTable.id, id), eq(ChatExportTable.exporterId, userId)),
      );
    return result.length > 0;
  },
  deleteById: async (id) => {
    await pgDb.delete(ChatExportTable).where(eq(ChatExportTable.id, id));
  },
  isExpired: async (id) => {
    const [result] = await pgDb
      .select({
        expiresAt: ChatExportTable.expiresAt,
      })
      .from(ChatExportTable)
      .where(eq(ChatExportTable.id, id));
    return !!result?.expiresAt && result.expiresAt < new Date();
  },
  insertComment: async (data) => {
    await pgDb.insert(ChatExportCommentTable).values(data);
  },
  selectCommentsByExportId: async (exportId, userId) => {
    const result = await pgDb
      .select({
        id: ChatExportCommentTable.id,
        exportId: ChatExportCommentTable.exportId,
        authorId: ChatExportCommentTable.authorId,
        parentId: ChatExportCommentTable.parentId,
        content: ChatExportCommentTable.content,
        createdAt: ChatExportCommentTable.createdAt,
        updatedAt: ChatExportCommentTable.updatedAt,
        authorName: UserTable.name,
        authorImage: UserTable.image,
      })
      .from(ChatExportCommentTable)
      .leftJoin(UserTable, eq(ChatExportCommentTable.authorId, UserTable.id))
      .where(eq(ChatExportCommentTable.exportId, exportId))
      .orderBy(ChatExportCommentTable.createdAt)
      .then((result) => {
        if (!userId) return result;
        return result.map((comment) => ({
          ...comment,
          isOwner: comment.authorId === userId,
        }));
      });

    const commentsById = new Map<string, ChatExportCommentWithUser>(
      result.map((comment) => [
        comment.id,
        comment as ChatExportCommentWithUser,
      ]),
    );
    result.forEach((comment) => {
      if (comment.parentId) {
        const parent = commentsById.get(comment.parentId);
        if (parent) {
          parent.replies = [
            ...(parent.replies || []),
            comment as ChatExportCommentWithUser,
          ];
        }
      }
    });

    return result.filter(
      (comment) => !comment.parentId,
    ) as ChatExportCommentWithUser[];
  },
  checkCommentAccess: async (id, authorId) => {
    const result = await pgDb
      .select({
        authorId: ChatExportCommentTable.authorId,
      })
      .from(ChatExportCommentTable)
      .where(
        and(
          eq(ChatExportCommentTable.id, id),
          eq(ChatExportCommentTable.authorId, authorId),
        ),
      );
    return result.length > 0;
  },
  deleteComment: async (id, authorId) => {
    await pgDb
      .delete(ChatExportCommentTable)
      .where(
        and(
          eq(ChatExportCommentTable.id, id),
          eq(ChatExportCommentTable.authorId, authorId),
        ),
      );
  },
};

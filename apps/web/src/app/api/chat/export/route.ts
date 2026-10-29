import { ChatExportByThreadIdSchema } from "app-types/chat-export";
import { withAuth } from "auth/route-guard";
import { chatExportRepository, chatRepository } from "lib/db/repository";

export const POST = withAuth(async (req, session) => {
  const { threadId, expiresAt } = await ChatExportByThreadIdSchema.parse(
    await req.json(),
  );

  const isAccess = await chatRepository.checkAccess(threadId, session.user.id);
  if (!isAccess) {
    return new Response("Unauthorized", { status: 401 });
  }

  await chatExportRepository.exportChat({
    threadId,
    exporterId: session.user.id,
    expiresAt: expiresAt ?? undefined,
  });

  return Response.json({
    message: "Chat exported successfully",
  });
});

import ExportError from "@/components/export/error";
import { chatExportRepository } from "lib/db/repository";
import ChatPreview from "@/components/export/chat-preview";
import { getUserId } from "@/app/api/chat/actions";

export default async function ExportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const isExpired = await chatExportRepository.isExpired(id);
  if (isExpired) {
    return <ExportError message="This export has expired" />;
  }
  const thread = await chatExportRepository.selectByIdWithUser(id);
  if (!thread) {
    return <ExportError message="This export does not exist" />;
  }

  const userId = await getUserId().catch(() => undefined);

  const comments = userId
    ? await chatExportRepository.selectCommentsByExportId(id, userId)
    : [];

  return <ChatPreview thread={thread} comments={comments} />;
}

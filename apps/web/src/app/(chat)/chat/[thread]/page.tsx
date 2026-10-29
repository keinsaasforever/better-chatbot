import { selectThreadWithMessagesAction } from "@/app/api/chat/actions";
import ChatBot from "@/components/chat-bot";

import { redirect, RedirectType } from "next/navigation";

export default async function Page({
  params,
}: { params: Promise<{ thread: string }> }) {
  const { thread: threadId } = await params;

  // Loads session, the thread joined with its project name, and the newest
  // message window in a single parallel batch.
  const thread = await selectThreadWithMessagesAction(threadId);

  if (!thread) redirect("/", RedirectType.replace);

  return (
    <ChatBot
      threadId={threadId}
      initialMessages={thread.messages}
      projectInfo={thread.projectInfo}
      initialThread={{
        title: thread.title,
        projectId: thread.projectId,
        knowledgeBases: thread.knowledgeBases,
      }}
    />
  );
}

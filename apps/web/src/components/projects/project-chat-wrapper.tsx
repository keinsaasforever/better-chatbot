"use client";

import ChatBot from "@/components/chat-bot";
import { getProjectDraftThreadId } from "@/lib/chat/project-draft-thread";

interface ProjectChatWrapperProps {
  projectId: string;
  projectName: string;
  selectedThreadId?: string | null;
  stayInProject?: boolean;
  onThreadCreated?: (threadId: string) => void;
}

export function ProjectChatWrapper({
  projectId,
  projectName,
  selectedThreadId,
  stayInProject = false,
  onThreadCreated,
}: ProjectChatWrapperProps) {
  const threadId = selectedThreadId ?? getProjectDraftThreadId(projectId);

  return (
    <div className="relative isolate flex min-h-0 flex-col p-4">
      <ChatBot
        threadId={threadId}
        initialMessages={[]}
        projectInfo={{ id: projectId, name: projectName }}
        createProjectThreadOnSend={selectedThreadId ? undefined : projectId}
        navigateOnSend={!stayInProject}
        onThreadCreated={onThreadCreated}
        showProjectContextBadge={false}
        showDecorations={false}
        autoFocusInput={false}
        embedded
      />
    </div>
  );
}

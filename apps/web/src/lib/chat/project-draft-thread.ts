export const PROJECT_DRAFT_THREAD_PREFIX = "project-draft-";

export function getProjectDraftThreadId(projectId: string) {
  return `${PROJECT_DRAFT_THREAD_PREFIX}${projectId}`;
}

export function isProjectDraftThreadId(threadId: string) {
  return threadId.startsWith(PROJECT_DRAFT_THREAD_PREFIX);
}

export function getProjectIdFromDraftThreadId(threadId: string) {
  if (!isProjectDraftThreadId(threadId)) return null;
  return threadId.slice(PROJECT_DRAFT_THREAD_PREFIX.length) || null;
}

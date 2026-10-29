import "server-only";
import { requestStop } from "@/lib/ai/chat-stream-context";
import { chatRepository } from "lib/db/repository";
import { resolveChatSession } from "../../route-helpers";

// Detached stop: sets the Redis stop flag the running chat function polls, so a
// stop survives a closed tab. No-op (still 204) when Redis is unconfigured — the
// viewer-bound abort in Phase 1 already covers that case.
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const sessionOrResponse = await resolveChatSession(request);
  if (sessionOrResponse instanceof Response) return sessionOrResponse;
  const { session } = sessionOrResponse;

  const thread = await chatRepository.selectThread(id);
  if (!thread || thread.userId !== session.user.id) {
    return new Response("Forbidden", { status: 403 });
  }

  await requestStop(id);
  return new Response(null, { status: 204 });
}

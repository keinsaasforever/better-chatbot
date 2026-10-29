import { HomeChat } from "@/components/home-chat";
import { logBootServerRender } from "@/lib/boot-diagnostics/server";

// Dynamic so the boot trace sees every render. Auth is already enforced by the
// (chat) layout, which redirects unauthenticated users to /sign-in, so this
// page does not repeat the session lookup.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  await logBootServerRender("/");
  // NOTE: do not mint the thread id here. This page is force-dynamic, so it
  // re-renders on every Server Action too, and a fresh id per render reached
  // ChatBot as a changed prop — rebuilding the chat and re-running every
  // threadId-keyed effect. ChatBot now mints its own id once, client-side, and
  // HomeChat owns the one thing that may reset it: an explicit "New chat".
  return <HomeChat />;
}

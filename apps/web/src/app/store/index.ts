import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ChatMention, ChatModel, ChatThread } from "app-types/chat";
import { AllowedMCPServer, MCPServerInfo } from "app-types/mcp";
import { DEFAULT_OPENAI_VOICE } from "lib/ai/speech/open-ai/voice-constants";
import { WorkflowSummary } from "app-types/workflow";
import { AppDefaultToolkit } from "lib/ai/tools";
import { filterDeferredAppToolkits } from "lib/ai/tools/resolve-allowed-toolkits";
import {
  APP_STORE_PERSIST_VERSION,
  migratePersistedAppState,
} from "./persist-migrate";
import { AgentSummary } from "app-types/agent";
import { SkillSummary } from "app-types/skill";
import type { UsageLimitStatus } from "lib/gate/types";

export interface UploadedFile {
  id: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
  isUploading?: boolean;
  progress?: number;
  previewUrl?: string;
  abortController?: AbortController;
  dataUrl?: string; // Full data URL format: "data:image/png;base64,..."
  /**
   * Brush mask drawn over this image in the composer (see
   * `components/image-mask-editor.tsx`): a PNG of the same size, white where
   * the model may change the photo. Uploaded like any attachment.
   */
  mask?: { url: string };
}

/** The mask the next request should carry, captured from the composer on send. */
export interface ThreadImageMask {
  imageUrl: string;
  maskUrl: string;
}

export interface AppState {
  threadList: ChatThread[];
  agentList: AgentSummary[];
  skillList: SkillSummary[];
  workflowToolList: WorkflowSummary[];
  currentThreadId: ChatThread["id"] | null;
  toolChoice: "auto" | "none" | "manual";
  // Plan mode: research with parallel subagents, deliver a plan artifact,
  // execute nothing. Orthogonal to toolChoice (its 3-way shortcut cycle
  // stays untouched).
  planMode: boolean;
  allowedMcpServers?: Record<string, AllowedMCPServer>;
  allowedAppDefaultToolkit?: AppDefaultToolkit[];
  generatingTitleThreadIds: string[];
  threadMentions: {
    [threadId: string]: ChatMention[];
  };
  threadFiles: {
    [threadId: string]: UploadedFile[];
  };
  threadImageToolModel: {
    [threadId: string]: string | undefined;
  };
  threadImageMask: {
    [threadId: string]: ThreadImageMask | undefined;
  };
  toolPresets: {
    allowedMcpServers?: Record<string, AllowedMCPServer>;
    allowedAppDefaultToolkit?: AppDefaultToolkit[];
    name: string;
  }[];
  chatModel?: ChatModel;
  autoRouting: boolean;
  openShortcutsPopup: boolean;
  openChatPreferences: boolean;
  openProblemReport: boolean;
  openUserSettings: boolean;
  openUserUsage: boolean;
  openOrgSettings: boolean;
  openReferral: boolean;
  openWorkflowBuilder: boolean;
  openSalesAgentBuilder: boolean;
  openBlogAgentBuilder: boolean;
  openDocExtractionBuilder: boolean;
  openAgentLibrary: boolean;
  resumeWorkflowId: string | null;
  // Seeded from the server by `UsageLimitSync`; null wherever that is not
  // mounted. `lib/billing/require-credits.ts` treats null as "not over limit"
  // so a missing status never blocks an action. Neither field is persisted —
  // dismissal lives in sessionStorage instead (see usage-limit-dismissal.ts).
  usageLimit: UsageLimitStatus | null;
  openUsageLimit: boolean;
  mcpCustomizationPopup?: MCPServerInfo & { id: string };
  temporaryChat: {
    isOpen: boolean;
    instructions: string;
    chatModel?: ChatModel;
  };
  voiceChat: {
    isOpen: boolean;
    agentId?: string;
    /**
     * Where the session was opened from, for its instructions ("cockpit" adds
     * the oversight prompt and shows the floating orb instead of the drawer).
     * Never persisted.
     */
    context?: "cockpit";
    options: {
      provider: string;
      providerOptions?: Record<string, any>;
    };
  };
  pendingThreadMention?: ChatMention;
  /**
   * Bumped by `useStartNewChat`. `HomeChat` keys `ChatBot` on it, so a bump is
   * what actually opens a new chat on "/": the route stays mounted across a
   * push/refresh (and the first send only *rewrites* the URL to /chat/<id>),
   * so nothing the router does resets the thread id or the messages.
   * Deliberately not persisted — every reload starts a fresh chat anyway.
   */
  newChatToken: number;
}

export interface AppDispatch {
  mutate: (state: Mutate<AppState>) => void;
}

const initialState: AppState = {
  threadList: [],
  generatingTitleThreadIds: [],
  threadMentions: {},
  threadFiles: {},
  threadImageToolModel: {},
  threadImageMask: {},
  agentList: [],
  skillList: [],
  workflowToolList: [],
  currentThreadId: null,
  toolChoice: "auto",
  planMode: false,
  allowedMcpServers: undefined,
  openUserSettings: false,
  openUserUsage: false,
  openOrgSettings: false,
  openReferral: false,
  openWorkflowBuilder: false,
  openSalesAgentBuilder: false,
  openBlogAgentBuilder: false,
  openDocExtractionBuilder: false,
  openAgentLibrary: false,
  resumeWorkflowId: null,
  usageLimit: null,
  openUsageLimit: false,
  allowedAppDefaultToolkit: [
    AppDefaultToolkit.Code,
    AppDefaultToolkit.Visualization,
    AppDefaultToolkit.WebSearch,
    // Browser automation carries its own hard gates — KERNEL_API_KEY and the
    // org's `browser_automation_enabled` policy — so leaving it out here just
    // means an admin who opts the workspace in sees nothing happen.
    AppDefaultToolkit.BrowserAutomation,
  ],
  toolPresets: [],
  chatModel: undefined,
  autoRouting: false,
  openShortcutsPopup: false,
  openChatPreferences: false,
  openProblemReport: false,
  mcpCustomizationPopup: undefined,
  temporaryChat: {
    isOpen: false,
    instructions: "",
  },
  voiceChat: {
    isOpen: false,
    options: {
      provider: "openai",
      providerOptions: {
        voice: DEFAULT_OPENAI_VOICE,
      },
    },
  },
  pendingThreadMention: undefined,
  newChatToken: 0,
};

export const appStore = create<AppState & AppDispatch>()(
  persist(
    (set) => ({
      ...initialState,
      mutate: set,
    }),
    {
      name: "mc-app-store-v2.0.1",
      version: APP_STORE_PERSIST_VERSION,
      migrate: migratePersistedAppState,
      partialize: (state) => ({
        chatModel: state.chatModel || initialState.chatModel,
        autoRouting: state.autoRouting,
        toolChoice: state.toolChoice || initialState.toolChoice,
        planMode: state.planMode ?? initialState.planMode,
        allowedMcpServers:
          state.allowedMcpServers || initialState.allowedMcpServers,
        allowedAppDefaultToolkit: filterDeferredAppToolkits(
          (state.allowedAppDefaultToolkit ??
            initialState.allowedAppDefaultToolkit) as AppDefaultToolkit[],
        )?.filter((v) => Object.values(AppDefaultToolkit).includes(v)),
        temporaryChat: {
          ...initialState.temporaryChat,
          ...state.temporaryChat,
          isOpen: false,
        },
        toolPresets: state.toolPresets || initialState.toolPresets,
        voiceChat: {
          ...initialState.voiceChat,
          ...state.voiceChat,
          isOpen: false,
          context: undefined,
        },
      }),
    },
  ),
);

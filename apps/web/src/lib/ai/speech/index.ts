import { UIMessage } from "ai";
import { ChatMention } from "app-types/chat";
import type { VoiceSessionConfirmation } from "lib/ai/speech/open-ai/voice-settings";
import type { VoiceBrowserFrame } from "lib/voice/browser-run-contract";
import { VoiceToolStatus } from "lib/voice/types";

export type UIMessageWithCompleted = UIMessage & { completed: boolean };

export interface VoiceChatSession {
  isActive: boolean;
  isListening: boolean;
  isUserSpeaking: boolean;
  isAssistantSpeaking: boolean;
  isLoading: boolean;
  messages: UIMessageWithCompleted[];
  /**
   * The chat thread this conversation is being saved into, once at least one
   * turn has landed there. `null` before that — including for a hook that does
   * not persist — so the UI can only offer a link that actually resolves.
   */
  threadId: string | null;
  error: Error | null;
  toolStatus: VoiceToolStatus;
  toolWarning: string | null;
  /**
   * Whether this session was offered the browser tools. Decided once at connect
   * time by the org AI policy, so the tools list can show what is really there.
   */
  browserAutomationEnabled: boolean;
  /**
   * The latest frame of a browser run started in this session, or `null` when
   * none has run. Drives the live-view panel in the voice drawer.
   */
  browserPreview: VoiceBrowserFrame | null;
  dismissBrowserPreview: () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  /**
   * Push-to-talk press and release. Only act in a session started with
   * `ptt: true`; elsewhere they are no-ops.
   */
  pushToTalkStart?: () => void;
  pushToTalkEnd?: () => void;
  /**
   * Silence the current answer now (stop playback, truncate what was not
   * heard, cancel the response) without touching the mic, so the user's next
   * turn is still heard.
   */
  interruptResponse?: () => void;
  /** Whether the server's `session.updated` echo matched the settings sent. */
  sessionConfirmation?: VoiceSessionConfirmation;
  /** A settings change is waiting for the current answer to finish. */
  settingsPending?: boolean;
  /** The preset the live session speaks with; a new pick applies next start. */
  sessionVoice?: string;
}

export type VoiceChatOptions = {
  toolMentions?: ChatMention[];
  agentId?: string;
  model?: string;
  voice?: string;
  /**
   * Where the session is opened from. `"cockpit"` makes the server append the
   * flight-deck oversight prompt to the instructions.
   */
  context?: "cockpit";
  /**
   * Push-to-talk: turn detection off; the caller drives each turn with
   * `pushToTalkStart` / `pushToTalkEnd`. Fixed for the life of a session.
   */
  ptt?: boolean;
  /**
   * Raw `VoiceSettings` from the store (speed, interruptions, turn detection);
   * validated by the hook before anything is sent.
   */
  settings?: unknown;
  /**
   * Connect without a start button: once per mount, as soon as this becomes
   * true and the requested context is prepared.
   */
  autoStart?: boolean;
};

export type VoiceChatHook = (props?: {
  [key: string]: any;
}) => VoiceChatSession;

export const DEFAULT_VOICE_TOOLS = [
  {
    type: "function",
    name: "changeBrowserTheme",
    description: "Change the browser theme",
    parameters: {
      type: "object",
      properties: {
        theme: {
          type: "string",
          enum: ["light", "dark"],
        },
      },
      required: ["theme"],
    },
  },
  {
    type: "function",
    name: "endConversation",
    description:
      "End the current voice conversation, similar to hanging up a call. This tool should be invoked when the user clearly expresses a desire to finish, exit, or end the dialogue.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

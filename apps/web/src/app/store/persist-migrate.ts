import { AppDefaultToolkit } from "lib/ai/tools";

/**
 * Version of the persisted app store payload. Bump together with a case in
 * `migratePersistedAppState` whenever an already-persisted field needs a
 * one-time rewrite — renaming the storage key instead would throw away the
 * user's model choice, presets and every other setting.
 */
export const APP_STORE_PERSIST_VERSION = 3;

/**
 * v0 -> v1: `browserAutomation` joined the default `allowedAppDefaultToolkit`
 * (commit a810f0e), but zustand rehydration lets the persisted array win over
 * a changed default — so every existing client kept sending the old list and
 * the browser tool was filtered out server-side before any other gate ran.
 * Appending once here is what actually ships the new default to existing
 * sessions; users can still toggle the toolkit off afterwards.
 *
 * Deliberately tolerant of shape drift: anything unexpected is returned
 * untouched, since a failed migration would otherwise drop the whole
 * persisted state.
 */
export function migratePersistedAppState(
  persistedState: unknown,
  version: number,
): unknown {
  if (version >= APP_STORE_PERSIST_VERSION) return persistedState;
  if (typeof persistedState !== "object" || persistedState === null) {
    return persistedState;
  }

  let state = persistedState as Record<string, unknown>;
  if (version < 1) state = appendBrowserAutomationToolkit(state);
  if (version < 2) state = moveDefaultVoice(state, "ash", "marin");
  if (version < 3) state = moveDefaultVoice(state, "marin", "jarvis");
  return state;
}

function appendBrowserAutomationToolkit(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const toolkits = state.allowedAppDefaultToolkit;
  if (
    Array.isArray(toolkits) &&
    !toolkits.includes(AppDefaultToolkit.BrowserAutomation)
  ) {
    return {
      ...state,
      allowedAppDefaultToolkit: [
        ...toolkits,
        AppDefaultToolkit.BrowserAutomation,
      ],
    };
  }
  return state;
}

/**
 * v1 -> v2: the default realtime voice moved from `ash` to `marin`.
 * v2 -> v3: and from `marin` to the `jarvis` preset.
 *
 * The old default was persisted for every client that ever opened the app,
 * so — same reasoning as v0 -> v1 — a new default only reaches existing users
 * through this rewrite. A persisted old default cannot be told apart from a
 * deliberate pick; moving it is the accepted cost. Any voice the drawer no
 * longer offers resolves to the default at runtime (`resolveOpenAIVoicePreset`).
 */
function moveDefaultVoice(
  state: Record<string, unknown>,
  from: string,
  to: string,
): Record<string, unknown> {
  const voiceChat = state.voiceChat as
    | { options?: { providerOptions?: Record<string, unknown> } }
    | undefined;
  if (voiceChat?.options?.providerOptions?.voice !== from) return state;
  return {
    ...state,
    voiceChat: {
      ...voiceChat,
      options: {
        ...voiceChat.options,
        providerOptions: {
          ...voiceChat.options.providerOptions,
          voice: to,
        },
      },
    },
  };
}

import { AppDefaultToolkit } from "lib/ai/tools";
import { describe, expect, it } from "vitest";
import {
  APP_STORE_PERSIST_VERSION,
  migratePersistedAppState,
} from "./persist-migrate";

describe("migratePersistedAppState", () => {
  // The situation the migration exists for: a client that persisted its
  // toolkit list before browserAutomation joined the default. Rehydration
  // lets that stored array win over the changed default, so without the
  // migration the browser tool never reaches existing sessions.
  it("appends browserAutomation to a v0 toolkit list that lacks it", () => {
    const migrated = migratePersistedAppState(
      {
        chatModel: { provider: "openai", model: "gpt-4o" },
        allowedAppDefaultToolkit: [
          AppDefaultToolkit.Code,
          AppDefaultToolkit.Visualization,
          AppDefaultToolkit.WebSearch,
        ],
      },
      0,
    ) as { allowedAppDefaultToolkit: string[]; chatModel: unknown };

    expect(migrated.allowedAppDefaultToolkit).toContain(
      AppDefaultToolkit.BrowserAutomation,
    );
    // The rest of the persisted state must survive untouched.
    expect(migrated.chatModel).toEqual({ provider: "openai", model: "gpt-4o" });
  });

  it("does not duplicate the toolkit when it is already present", () => {
    const state = {
      allowedAppDefaultToolkit: [
        AppDefaultToolkit.Code,
        AppDefaultToolkit.BrowserAutomation,
      ],
    };

    expect(migratePersistedAppState(state, 0)).toBe(state);
  });

  it("leaves current-version state alone", () => {
    const state = { allowedAppDefaultToolkit: [AppDefaultToolkit.Code] };

    expect(migratePersistedAppState(state, APP_STORE_PERSIST_VERSION)).toBe(
      state,
    );
  });

  // A failed migration would drop the whole persisted state, which is worse
  // than skipping the rewrite — unexpected shapes pass through untouched.
  it.each([null, undefined, "corrupt", { allowedAppDefaultToolkit: "nope" }])(
    "passes unexpected shapes through untouched (%j)",
    (state) => {
      expect(migratePersistedAppState(state, 0)).toBe(state);
    },
  );
  describe("v1 -> v2: default voice", () => {
    const withVoice = (voice: string) => ({
      voiceChat: {
        isOpen: false,
        options: { provider: "openai", providerOptions: { voice } },
      },
      chatModel: { provider: "openai", model: "gpt-4o" },
    });

    it("moves the old default ash on through marin to jarvis", () => {
      const migrated = migratePersistedAppState(withVoice("ash"), 1) as {
        voiceChat: { options: { providerOptions: { voice: string } } };
        chatModel: unknown;
      };
      expect(migrated.voiceChat.options.providerOptions.voice).toBe("jarvis");
      expect(migrated.chatModel).toEqual({
        provider: "openai",
        model: "gpt-4o",
      });
    });

    it("keeps any other voice the user picked", () => {
      const state = withVoice("coral");
      expect(migratePersistedAppState(state, 1)).toBe(state);
    });

    it("runs every step for a v0 client", () => {
      const migrated = migratePersistedAppState(
        { ...withVoice("ash"), allowedAppDefaultToolkit: [] },
        0,
      ) as {
        voiceChat: { options: { providerOptions: { voice: string } } };
        allowedAppDefaultToolkit: string[];
      };
      expect(migrated.voiceChat.options.providerOptions.voice).toBe("jarvis");
      expect(migrated.allowedAppDefaultToolkit).toContain(
        AppDefaultToolkit.BrowserAutomation,
      );
    });
  });
  describe("v2 -> v3: jarvis becomes the default voice", () => {
    const withVoice = (voice: string) => ({
      voiceChat: {
        isOpen: false,
        options: { provider: "openai", providerOptions: { voice } },
      },
    });

    it("moves the old default marin to jarvis", () => {
      const migrated = migratePersistedAppState(withVoice("marin"), 2) as {
        voiceChat: { options: { providerOptions: { voice: string } } };
      };
      expect(migrated.voiceChat.options.providerOptions.voice).toBe("jarvis");
    });

    it("keeps cedar, which was never the default", () => {
      const state = withVoice("cedar");
      expect(migratePersistedAppState(state, 2)).toBe(state);
    });
  });
});

// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";

const mocks = vi.hoisted(() => ({
  session: {
    isActive: false,
    isUserSpeaking: false,
    isAssistantSpeaking: false,
    isLoading: true,
    error: null as Error | null,
    browserPreview: null,
    dismissBrowserPreview: () => {},
    stop: vi.fn(async () => {}),
  },
  options: null as Record<string, unknown> | null,
  mentionsLoading: false,
  toastError: vi.fn(),
}));

vi.mock("lib/ai/speech/open-ai/use-voice-chat.openai", () => ({
  useOpenAIVoiceChat: (options: Record<string, unknown>) => {
    mocks.options = options;
    return mocks.session;
  },
}));
vi.mock("@/hooks/use-voice-tool-mentions", () => ({
  useVoiceToolMentions: () => ({
    toolMentions: [],
    agent: undefined,
    isLoading: mocks.mentionsLoading,
  }),
}));
// WebGL is out of reach in jsdom; the scene is covered by the visual check.
vi.mock("next/dynamic", () => ({
  default: () =>
    function OrbSceneStub({ hovered }: { hovered: boolean }) {
      return <div data-testid="orb-scene" data-hovered={String(hovered)} />;
    },
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

const { appStore } = await import("@/app/store");
const { useVoiceLiveStatus, VOICE_LIVE_IDLE } = await import(
  "lib/voice/voice-live-status"
);
const { VoiceOrb } = await import("./voice-orb");

// jsdom has no PointerEvent; a MouseEvent carrying the pointer fields will do.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

function renderOrb() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VoiceOrb />
    </NextIntlClientProvider>,
  );
}

const orb = () => screen.getByRole("group", { name: /Voice copilot/ });
const closeButton = () =>
  screen.getByRole("button", { name: "End voice chat" });

describe("VoiceOrb", () => {
  beforeEach(() => {
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    HTMLElement.prototype.setPointerCapture = vi.fn();
    window.localStorage.clear();
    Object.assign(mocks.session, {
      isActive: false,
      isUserSpeaking: false,
      isAssistantSpeaking: false,
      isLoading: true,
      error: null,
    });
    mocks.session.stop.mockClear();
    mocks.toastError.mockClear();
    mocks.mentionsLoading = false;
    useVoiceLiveStatus.setState(VOICE_LIVE_IDLE);
    appStore.setState((s) => ({
      voiceChat: { ...s.voiceChat, isOpen: true, context: "cockpit" },
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts a cockpit session by itself once the tool list is in", () => {
    mocks.mentionsLoading = true;
    const { rerender } = renderOrb();
    expect(mocks.options).toMatchObject({
      context: "cockpit",
      autoStart: false,
    });

    mocks.mentionsLoading = false;
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <VoiceOrb />
      </NextIntlClientProvider>,
    );
    expect(mocks.options).toMatchObject({ autoStart: true });
    expect(orb().getAttribute("data-mode")).toBe("connecting");
    // COM 1 follows the orb's session.
    expect(useVoiceLiveStatus.getState().phase).toBe("connecting");
  });

  it("hangs up from the X and puts the orb away", async () => {
    Object.assign(mocks.session, { isActive: true, isLoading: false });
    renderOrb();
    expect(orb().getAttribute("data-mode")).toBe("listening");

    await act(async () => {
      fireEvent.click(closeButton());
    });
    expect(mocks.session.stop).toHaveBeenCalledTimes(1);
    expect(appStore.getState().voiceChat).toMatchObject({
      isOpen: false,
      context: undefined,
    });
  });

  it("can be dragged, stays where it was dropped, and pulses on hover", () => {
    renderOrb();
    const start = {
      left: Number.parseFloat(orb().style.left),
      top: Number.parseFloat(orb().style.top),
    };

    fireEvent.pointerEnter(orb(), { pointerType: "mouse" });
    expect(screen.getByTestId("orb-scene").getAttribute("data-hovered")).toBe(
      "true",
    );

    fireEvent.pointerDown(orb(), { button: 0, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(orb(), { clientX: 400, clientY: 350 });
    fireEvent.pointerUp(orb(), { clientX: 400, clientY: 350 });

    expect(Number.parseFloat(orb().style.left)).toBe(start.left - 100);
    expect(Number.parseFloat(orb().style.top)).toBe(start.top - 150);
    expect(
      JSON.parse(window.localStorage.getItem("cockpit.voiceOrb.position")!),
    ).toEqual({ x: start.left - 100, y: start.top - 150 });
    // A drag is not a click on the X underneath.
    expect(mocks.session.stop).not.toHaveBeenCalled();
  });

  it("shows the X on a tap, since touch has no hover", () => {
    renderOrb();
    expect(closeButton().className).toContain("pointer-events-none");
    fireEvent.pointerDown(orb(), {
      button: 0,
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(orb(), {
      pointerType: "touch",
      clientX: 11,
      clientY: 10,
    });
    expect(closeButton().className).toContain("pointer-events-auto");
    expect(closeButton().className).not.toContain(" pointer-events-none");
  });

  it("says what went wrong and closes on a session error", async () => {
    mocks.session.error = new Error("Permission denied");
    await act(async () => {
      renderOrb();
    });
    expect(mocks.toastError).toHaveBeenCalledWith("Permission denied");
    expect(appStore.getState().voiceChat.isOpen).toBe(false);
  });
});

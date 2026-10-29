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
import messages from "../../../messages/en.json";

const requireCredits = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/lib/billing/require-credits", () => ({ requireCredits }));

const { appStore } = await import("@/app/store");
const { useVoiceLiveStatus, VOICE_LIVE_IDLE } = await import(
  "lib/voice/voice-live-status"
);
const { VoicePushbutton, comLed } = await import("./voice-pushbutton");

function renderButton() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <VoicePushbutton />
    </NextIntlClientProvider>,
  );
}

const button = () =>
  screen.getByRole("button", { name: /Talk to the cockpit copilot/ });

describe("comLed", () => {
  it("is off while the drawer is closed, whatever the stale status says", () => {
    expect(comLed(false, { phase: "connected", userSpeaking: true })).toBe(
      "off",
    );
  });

  it("goes standby, connecting, connected and speaking with the session", () => {
    expect(comLed(true, VOICE_LIVE_IDLE)).toBe("standby");
    expect(comLed(true, { phase: "connecting", userSpeaking: false })).toBe(
      "connecting",
    );
    expect(comLed(true, { phase: "connected", userSpeaking: false })).toBe(
      "connected",
    );
    expect(comLed(true, { phase: "connected", userSpeaking: true })).toBe(
      "speaking",
    );
  });
});

describe("VoicePushbutton", () => {
  beforeEach(() => {
    requireCredits.mockClear();
    requireCredits.mockReturnValue(true);
    useVoiceLiveStatus.setState(VOICE_LIVE_IDLE);
    appStore.setState((s) => ({
      voiceChat: {
        ...s.voiceChat,
        isOpen: false,
        context: undefined,
        agentId: "agent-1",
      },
    }));
  });
  afterEach(cleanup);

  it("shows COM 1 · PTT with the LED off when no session is open", () => {
    renderButton();
    expect(screen.getByText("COM 1")).toBeTruthy();
    expect(screen.getByText("PTT")).toBeTruthy();
    expect(button().getAttribute("data-led")).toBe("off");
    expect(button().getAttribute("aria-label")).toContain("Voice off");
  });

  it("opens the voice orb in cockpit context after the credit check", () => {
    renderButton();
    fireEvent.click(button());
    expect(requireCredits).toHaveBeenCalledTimes(1);
    const { voiceChat } = appStore.getState();
    expect(voiceChat).toMatchObject({ isOpen: true, context: "cockpit" });
    expect(voiceChat.agentId).toBeUndefined();
  });

  it("does nothing when credits are exhausted", () => {
    requireCredits.mockReturnValue(false);
    renderButton();
    fireEvent.click(button());
    expect(appStore.getState().voiceChat.isOpen).toBe(false);
  });

  it("follows the live session: amber while connecting, green connected, pulsing while the user speaks", () => {
    renderButton();
    act(() => {
      appStore.setState((s) => ({
        voiceChat: { ...s.voiceChat, isOpen: true, context: "cockpit" },
      }));
      useVoiceLiveStatus.setState({ phase: "connecting", userSpeaking: false });
    });
    expect(button().getAttribute("data-led")).toBe("connecting");

    act(() => {
      useVoiceLiveStatus.setState({ phase: "connected", userSpeaking: false });
    });
    expect(button().getAttribute("data-led")).toBe("connected");
    expect(button().getAttribute("aria-label")).toContain("Connected");

    act(() => {
      useVoiceLiveStatus.setState({ phase: "connected", userSpeaking: true });
    });
    expect(button().getAttribute("data-led")).toBe("speaking");
    expect(
      button().querySelector(".motion-safe\\:animate-pulse"),
    ).not.toBeNull();

    // A second press while the drawer is open opens nothing new.
    fireEvent.click(button());
    expect(requireCredits).not.toHaveBeenCalled();
  });
});

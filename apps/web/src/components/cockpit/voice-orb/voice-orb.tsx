"use client";

import { appStore } from "@/app/store";
import { useVoiceToolMentions } from "@/hooks/use-voice-tool-mentions";
import { useOpenAIVoiceChat } from "lib/ai/speech/open-ai/use-voice-chat.openai";
import { cn } from "lib/utils";
import { useMirrorVoiceLiveStatus } from "lib/voice/voice-live-status";
import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { safe } from "ts-safe";
import { useShallow } from "zustand/shallow";
import { VoiceBrowserPreview } from "../../voice/voice-browser-preview";
import { CK } from "../instruments";
import {
  ORB_BOX,
  type OrbPosition,
  clampOrbPosition,
  defaultOrbPosition,
  orbMode,
  parseOrbPosition,
} from "./orb-state";

// WebGL only exists in the browser; until it loads the box is just the glow.
const OrbScene = dynamic(() => import("./orb-scene"), { ssr: false });

const POSITION_KEY = "cockpit.voiceOrb.position";
/** Pointer travel before a press counts as a drag rather than a tap. */
const DRAG_THRESHOLD = 4;
/** Arrow keys move the orb this far; with Shift, four times as far. */
const KEY_STEP = 24;

const viewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

function initialPosition(): OrbPosition {
  let saved: OrbPosition | null = null;
  try {
    saved = parseOrbPosition(window.localStorage.getItem(POSITION_KEY));
  } catch {
    // Storage can be blocked; the default spot is fine.
  }
  return clampOrbPosition(saved ?? defaultOrbPosition(viewport()), viewport());
}

function savePosition(position: OrbPosition) {
  try {
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {
    // Not remembering the spot is harmless.
  }
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * The cockpit's voice session as a small floating orb instead of the
 * full-screen drawer: COM 1 opens it, it connects on its own and the copilot
 * greets first. Drag it anywhere; hover (or tap, on touch) shows the X that
 * hangs up. The conversation is still saved to a chat thread by the hook.
 */
export function VoiceOrb() {
  const t = useTranslations("Cockpit.com.orb");
  const [agentId, voiceChat] = appStore(
    useShallow((state) => [state.voiceChat.agentId, state.voiceChat]),
  );
  const { toolMentions, isLoading: mentionsLoading } =
    useVoiceToolMentions(agentId);

  const session = useOpenAIVoiceChat({
    toolMentions,
    agentId,
    ...voiceChat.options.providerOptions,
    context: voiceChat.context,
    // Wait for the MCP list so the session is prepared once, with the
    // mentions it will keep.
    autoStart: !mentionsLoading,
  });
  useMirrorVoiceLiveStatus(session);
  const { stop, error, browserPreview, dismissBrowserPreview } = session;
  const mode = orbMode(session);

  const [position, setPosition] = useState(initialPosition);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Touch has no hover: a tap pins the X open instead.
  const [revealed, setRevealed] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const hintId = useId();
  const drag = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const onResize = () =>
      setPosition((current) => clampOrbPosition(current, viewport()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const closingRef = useRef(false);
  const hangUp = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    await safe(() => stop());
    appStore.setState((state) => ({
      voiceChat: {
        ...state.voiceChat,
        isOpen: false,
        // The opener sets it again; a stale "cockpit" must not follow the
        // user into the next voice chat opened from somewhere else.
        context: undefined,
      },
    }));
  }, [stop]);

  // No drawer to show an error in: say it once and put the orb away.
  useEffect(() => {
    if (!error) return;
    toast.error(error.message);
    void hangUp();
  }, [error, hangUp]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (
      !current.moved &&
      Math.hypot(
        event.clientX - current.startX,
        event.clientY - current.startY,
      ) < DRAG_THRESHOLD
    ) {
      return;
    }
    current.moved = true;
    setDragging(true);
    setPosition(
      clampOrbPosition(
        {
          x: event.clientX - current.offsetX,
          y: event.clientY - current.offsetY,
        },
        viewport(),
      ),
    );
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (current.moved) {
      savePosition(
        clampOrbPosition(
          {
            x: event.clientX - current.offsetX,
            y: event.clientY - current.offsetY,
          },
          viewport(),
        ),
      );
    } else if (!cancelled && event.pointerType !== "mouse") {
      setRevealed((value) => !value);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = move[event.key];
    if (!delta || event.target !== event.currentTarget) return;
    event.preventDefault();
    const next = clampOrbPosition(
      { x: position.x + delta[0], y: position.y + delta[1] },
      viewport(),
    );
    setPosition(next);
    savePosition(next);
  };

  const stateLabel = t(`state.${mode}`);

  return (
    <>
      <div
        role="group"
        tabIndex={0}
        aria-label={`${t("label")}: ${stateLabel}`}
        aria-describedby={hintId}
        title={`${t("label")} · ${stateLabel}`}
        data-mode={mode}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, false)}
        onPointerCancel={(event) => endDrag(event, true)}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setHovered(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setHovered(false);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "group fixed z-50 touch-none select-none rounded-full outline-none",
          "focus-visible:ring-2 focus-visible:ring-[#4fd8ff]",
          "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:duration-300",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{
          left: position.x,
          top: position.y,
          width: ORB_BOX,
          height: ORB_BOX,
          // Shown until WebGL is up, and the fallback if it never is.
          background: `radial-gradient(circle at 50% 55%, rgba(61,90,254,0.55) 0%, rgba(10,0,224,0.35) 32%, transparent 58%)`,
        }}
      >
        <OrbScene
          mode={mode}
          hovered={hovered || revealed || dragging}
          reducedMotion={reducedMotion}
        />
        <button
          type="button"
          aria-label={t("end")}
          title={t("end")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => void hangUp()}
          className={cn(
            "absolute right-3 top-3 flex size-6 cursor-pointer items-center justify-center rounded-full bg-[#15181c] ring-1 ring-black",
            "shadow-[0_2px_8px_rgba(0,0,0,0.7)] transition-[opacity,transform,color] duration-150",
            "hover:text-[#ff4d4d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4fd8ff]",
            // Hidden means unclickable too: a tap on the orb must never land
            // on an invisible hang-up button.
            "group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100",
            "group-focus-visible:pointer-events-auto group-focus-visible:scale-100 group-focus-visible:opacity-100",
            "focus-visible:pointer-events-auto focus-visible:scale-100 focus-visible:opacity-100",
            revealed
              ? "pointer-events-auto scale-100 opacity-100"
              : "pointer-events-none scale-75 opacity-0",
          )}
          style={{ color: CK.white }}
        >
          <XIcon className="size-3.5" aria-hidden />
        </button>
        <span id={hintId} className="sr-only">
          {t("hint")}
        </span>
        <span className="sr-only" aria-live="polite">
          {stateLabel}
        </span>
      </div>

      {/* A browser run has to stay watchable without the drawer. */}
      {browserPreview && (
        <div className="fixed bottom-4 left-4 z-50 h-[min(60vh,440px)] w-[min(560px,calc(100vw-2rem))]">
          <VoiceBrowserPreview
            frame={browserPreview}
            onDismiss={dismissBrowserPreview}
          />
        </div>
      )}
    </>
  );
}

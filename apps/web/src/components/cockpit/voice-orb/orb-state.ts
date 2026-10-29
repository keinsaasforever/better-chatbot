/**
 * Pure state for the cockpit's floating voice orb: what it shows, how hard it
 * moves, and where it may sit. Kept free of React and three.js so it can be
 * tested on its own.
 */

export type OrbMode = "connecting" | "listening" | "user" | "assistant";

export function orbMode(session: {
  isActive: boolean;
  isUserSpeaking: boolean;
  isAssistantSpeaking: boolean;
}): OrbMode {
  if (!session.isActive) return "connecting";
  if (session.isAssistantSpeaking) return "assistant";
  if (session.isUserSpeaking) return "user";
  return "listening";
}

/** How hard the orb breathes, swirls and glows in each mode (0..1). */
export const ORB_ENERGY: Record<OrbMode, number> = {
  connecting: 0.08,
  listening: 0.2,
  user: 0.6,
  assistant: 0.85,
};

/** Edge length of the orb's square box, in CSS pixels. */
export const ORB_BOX = 120;

/** Space the orb keeps from the viewport edges. */
const EDGE = 8;
/** Where it first appears: bottom right, clear of the edges. */
const DEFAULT_INSET = 24;

export type OrbPosition = { x: number; y: number };
type Viewport = { width: number; height: number };

/** Keeps the orb's whole box on screen; top left wins on a tiny viewport. */
export function clampOrbPosition(
  position: OrbPosition,
  viewport: Viewport,
  box = ORB_BOX,
): OrbPosition {
  const maxX = Math.max(EDGE, viewport.width - box - EDGE);
  const maxY = Math.max(EDGE, viewport.height - box - EDGE);
  return {
    x: Math.round(Math.min(Math.max(position.x, EDGE), maxX)),
    y: Math.round(Math.min(Math.max(position.y, EDGE), maxY)),
  };
}

export function defaultOrbPosition(
  viewport: Viewport,
  box = ORB_BOX,
): OrbPosition {
  return clampOrbPosition(
    {
      x: viewport.width - box - DEFAULT_INSET,
      y: viewport.height - box - DEFAULT_INSET,
    },
    viewport,
    box,
  );
}

/** A saved position, or null when the stored value is missing or malformed. */
export function parseOrbPosition(raw: string | null): OrbPosition | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OrbPosition> | null;
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) {
      return { x: Number(value?.x), y: Number(value?.y) };
    }
  } catch {
    // Fall through: a corrupt value just means the default spot.
  }
  return null;
}

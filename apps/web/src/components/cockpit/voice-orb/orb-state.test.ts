import { describe, expect, it } from "vitest";
import {
  ORB_BOX,
  clampOrbPosition,
  defaultOrbPosition,
  orbMode,
  parseOrbPosition,
} from "./orb-state";

const viewport = { width: 1280, height: 800 };

describe("orbMode", () => {
  it("is connecting until the session is live", () => {
    expect(
      orbMode({
        isActive: false,
        isUserSpeaking: true,
        isAssistantSpeaking: true,
      }),
    ).toBe("connecting");
  });

  it("puts the assistant's voice ahead of the user's", () => {
    const live = { isActive: true, isUserSpeaking: false };
    expect(orbMode({ ...live, isAssistantSpeaking: false })).toBe("listening");
    expect(
      orbMode({ ...live, isUserSpeaking: true, isAssistantSpeaking: false }),
    ).toBe("user");
    expect(
      orbMode({ ...live, isUserSpeaking: true, isAssistantSpeaking: true }),
    ).toBe("assistant");
  });
});

describe("orb position", () => {
  it("starts bottom right, inside the viewport", () => {
    const { x, y } = defaultOrbPosition(viewport);
    expect(x + ORB_BOX).toBeLessThan(viewport.width);
    expect(y + ORB_BOX).toBeLessThan(viewport.height);
    expect(x).toBeGreaterThan(viewport.width / 2);
    expect(y).toBeGreaterThan(viewport.height / 2);
  });

  it("cannot be dragged off screen", () => {
    expect(clampOrbPosition({ x: -500, y: -20 }, viewport)).toEqual({
      x: 8,
      y: 8,
    });
    expect(clampOrbPosition({ x: 5000, y: 5000 }, viewport)).toEqual({
      x: viewport.width - ORB_BOX - 8,
      y: viewport.height - ORB_BOX - 8,
    });
  });

  it("pins to the top left on a viewport smaller than the orb", () => {
    expect(
      clampOrbPosition({ x: 40, y: 40 }, { width: 100, height: 90 }),
    ).toEqual({ x: 8, y: 8 });
  });

  it("reads back a saved position and ignores junk", () => {
    expect(parseOrbPosition('{"x":10,"y":20}')).toEqual({ x: 10, y: 20 });
    expect(parseOrbPosition(null)).toBeNull();
    expect(parseOrbPosition("not json")).toBeNull();
    expect(parseOrbPosition('{"x":"10"}')).toBeNull();
    expect(parseOrbPosition("null")).toBeNull();
  });
});

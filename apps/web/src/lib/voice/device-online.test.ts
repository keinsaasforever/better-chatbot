import { describe, expect, it } from "vitest";
import {
  formatLastSeen,
  getVoiceDeviceConnectionStatus,
} from "./device-online";

describe("device-online", () => {
  it("returns never_connected when lastSeenAt is missing", () => {
    expect(getVoiceDeviceConnectionStatus(null, "active")).toBe(
      "never_connected",
    );
  });

  it("returns offline for revoked devices", () => {
    expect(getVoiceDeviceConnectionStatus(new Date(), "revoked")).toBe(
      "offline",
    );
  });

  it("returns online when seen within threshold", () => {
    const recent = new Date(Date.now() - 60_000);
    expect(getVoiceDeviceConnectionStatus(recent, "active")).toBe("online");
  });

  it("returns offline when last seen is stale", () => {
    const stale = new Date(Date.now() - 10 * 60_000);
    expect(getVoiceDeviceConnectionStatus(stale, "active")).toBe("offline");
  });

  it("formats recent last seen labels", () => {
    const recent = new Date(Date.now() - 30_000);
    expect(formatLastSeen(recent)).toBe("just now");
  });
});

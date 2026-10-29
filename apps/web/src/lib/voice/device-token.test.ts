import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  generateDeviceToken,
  generatePairingCode,
  getVoiceDeviceTokenPepper,
  hashDeviceToken,
  hashPairingCode,
  isValidDeviceToken,
} from "./device-token";

describe("device-token", () => {
  beforeEach(() => {
    vi.stubEnv("VOICE_DEVICE_TOKEN_PEPPER", "test-pepper-value");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hashes device tokens deterministically without exposing the raw token", () => {
    const token = generateDeviceToken();
    expect(hashDeviceToken(token)).toBe(hashDeviceToken(token));
    expect(hashDeviceToken(token)).not.toContain(token);
  });

  it("hashes pairing codes separately from device tokens", () => {
    const code = "123456";
    expect(hashPairingCode(code)).not.toBe(hashDeviceToken(code));
  });

  it("generates valid device tokens", () => {
    const token = generateDeviceToken();
    expect(isValidDeviceToken(token)).toBe(true);
    expect(isValidDeviceToken("invalid")).toBe(false);
  });

  it("generates six digit pairing codes", () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("fails closed when pepper is missing", () => {
    vi.unstubAllEnvs();
    delete process.env.VOICE_DEVICE_TOKEN_PEPPER;
    expect(() => getVoiceDeviceTokenPepper()).toThrow(
      "VOICE_DEVICE_TOKEN_PEPPER is not configured",
    );
  });
});

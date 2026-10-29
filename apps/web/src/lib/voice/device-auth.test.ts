import { describe, expect, it, vi, beforeEach } from "vitest";
import { BasicUserWithLastLogin } from "app-types/user";
import { authenticateVoiceDevice } from "./device-auth";
import { generateDeviceToken, hashDeviceToken } from "./device-token";

vi.mock("lib/db/repository", () => ({
  voiceDeviceRepository: {
    selectByTokenHash: vi.fn(),
    touchLastSeen: vi.fn(),
  },
  userRepository: {
    getUserById: vi.fn(),
  },
}));

const { voiceDeviceRepository, userRepository } = await import(
  "lib/db/repository"
);

describe("authenticateVoiceDevice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VOICE_DEVICE_TOKEN_PEPPER", "test-pepper-value");
  });

  it("rejects missing bearer tokens", async () => {
    const result = await authenticateVoiceDevice(
      new Request("http://localhost/api/voice/transcript"),
    );
    expect(result).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    const result = await authenticateVoiceDevice(
      new Request("http://localhost/api/voice/transcript", {
        headers: { Authorization: "Bearer not-a-device-token" },
      }),
    );
    expect(result).toBeNull();
  });

  it("rejects revoked or unknown devices", async () => {
    const token = generateDeviceToken();
    vi.mocked(voiceDeviceRepository.selectByTokenHash).mockResolvedValue(null);

    const result = await authenticateVoiceDevice(
      new Request("http://localhost/api/voice/transcript", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(voiceDeviceRepository.selectByTokenHash).toHaveBeenCalledWith(
      hashDeviceToken(token),
    );
    expect(result).toBeNull();
  });

  it("returns actor data and updates last seen for active devices", async () => {
    const token = generateDeviceToken();
    vi.mocked(voiceDeviceRepository.selectByTokenHash).mockResolvedValue({
      id: "device-1",
      userId: "user-1",
      organizationId: "org-1",
      deviceType: "m5stack_atom_echo_s3r",
      displayName: "Desk Echo",
      status: "active",
    });
    vi.mocked(userRepository.getUserById).mockResolvedValue({
      id: "user-1",
      name: "Hagen",
      email: "h@example.com",
      image: null,
      lastLogin: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: true,
    } as BasicUserWithLastLogin);

    const result = await authenticateVoiceDevice(
      new Request("http://localhost/api/voice/transcript", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(result).toEqual({
      userId: "user-1",
      organizationId: "org-1",
      source: "m5stack",
      deviceId: "device-1",
      deviceDisplayName: "Desk Echo",
    });
    expect(voiceDeviceRepository.touchLastSeen).toHaveBeenCalledWith(
      "device-1",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  ClaimDeviceRegistrationSchema,
  CompleteDeviceRegistrationSchema,
  DeviceRegistrationSchema,
} from "./schemas";

describe("registration schemas", () => {
  it("accepts device registration payloads", () => {
    const parsed = DeviceRegistrationSchema.parse({
      code: "123456",
      deviceType: "m5stack_atom_echo_s3r",
      firmwareVersion: "0.1.0",
      hardwareId: "echo-abc",
    });
    expect(parsed.code).toBe("123456");
  });

  it("rejects invalid pairing codes", () => {
    expect(() => DeviceRegistrationSchema.parse({ code: "12345" })).toThrow();
  });

  it("accepts claim payloads with optional display name", () => {
    const parsed = ClaimDeviceRegistrationSchema.parse({ code: "654321" });
    expect(parsed.displayName).toBeUndefined();
  });

  it("accepts complete registration payloads", () => {
    const parsed = CompleteDeviceRegistrationSchema.parse({
      registrationId: "550e8400-e29b-41d4-a716-446655440000",
      code: "111222",
    });
    expect(parsed.registrationId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });
});

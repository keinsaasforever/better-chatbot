export type VoiceDeviceType = "m5stack_atom_echo_s3r";

export type VoiceDeviceStatus = "active" | "revoked";

export type VoiceDeviceSummary = {
  id: string;
  deviceType: VoiceDeviceType;
  displayName: string;
  status: VoiceDeviceStatus;
  firmwareVersion: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  connectionStatus?: "online" | "offline" | "never_connected";
};

export type VoiceDeviceHistoryItem = {
  id: string;
  sessionId: string;
  text: string;
  language: string | null;
  confidence: string | null;
  actionStatus: "stored" | "needs_review" | "executed" | "failed" | "ignored";
  message: string | null;
  actions: unknown[];
  createdAt: string;
};

export type VoiceDeviceRegistrationStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "expired";

export type VoiceDeviceRegistrationSummary = {
  id: string;
  deviceType: VoiceDeviceType;
  firmwareVersion: string | null;
  hardwareId: string | null;
  status: VoiceDeviceRegistrationStatus;
  userId: string | null;
  deviceId: string | null;
  displayName: string | null;
  expiresAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
};

export type VoiceDeviceRepository = {
  listByUserId: (userId: string) => Promise<VoiceDeviceSummary[]>;
  selectByTokenHash: (tokenHash: string) => Promise<{
    id: string;
    userId: string;
    organizationId: string | null;
    deviceType: VoiceDeviceType;
    displayName: string;
    status: VoiceDeviceStatus;
  } | null>;
  selectByIdForUser: (
    deviceId: string,
    userId: string,
  ) => Promise<VoiceDeviceSummary | null>;
  createDevice: (input: {
    userId: string;
    organizationId?: string | null;
    deviceType: VoiceDeviceType;
    displayName: string;
    tokenHash: string;
    firmwareVersion?: string | null;
  }) => Promise<VoiceDeviceSummary>;
  revokeDevice: (deviceId: string, userId: string) => Promise<boolean>;
  touchLastSeen: (deviceId: string) => Promise<void>;
  createPairingCode: (input: {
    userId: string;
    organizationId?: string | null;
    deviceType: VoiceDeviceType;
    displayName?: string | null;
    codeHash: string;
    expiresAt: Date;
  }) => Promise<{ id: string; expiresAt: Date }>;
  consumePairingCode: (input: {
    codeHash: string;
  }) => Promise<{
    id: string;
    userId: string;
    deviceType: VoiceDeviceType;
    displayName: string | null;
    organizationId: string | null;
  } | null>;
  createDeviceRegistration: (input: {
    codeHash: string;
    deviceType: VoiceDeviceType;
    firmwareVersion?: string | null;
    hardwareId?: string | null;
    expiresAt: Date;
  }) => Promise<VoiceDeviceRegistrationSummary>;
  selectRegistrationByCodeHash: (
    codeHash: string,
  ) => Promise<VoiceDeviceRegistrationSummary | null>;
  selectRegistrationById: (
    registrationId: string,
  ) => Promise<VoiceDeviceRegistrationSummary | null>;
  claimDeviceRegistration: (input: {
    registrationId: string;
    userId: string;
    organizationId?: string | null;
    displayName: string;
    deviceId: string;
    deliveryToken: string;
  }) => Promise<VoiceDeviceRegistrationSummary | null>;
  completeDeviceRegistration: (input: {
    registrationId: string;
    codeHash: string;
  }) => Promise<{
    registration: VoiceDeviceRegistrationSummary;
    deliveryToken: string;
  } | null>;
};

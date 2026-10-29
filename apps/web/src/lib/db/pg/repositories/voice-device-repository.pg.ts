import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  VoiceDeviceEntity,
  VoiceDevicePairingCodeTable,
  VoiceDeviceRegistrationEntity,
  VoiceDeviceRegistrationTable,
  VoiceDeviceTable,
} from "../schema.pg";
import { pgDb as db } from "../db.pg";
import {
  VoiceDeviceRegistrationSummary,
  VoiceDeviceRepository,
  VoiceDeviceSummary,
} from "app-types/voice-device";
import { getVoiceDeviceConnectionStatus } from "lib/voice/device-online";

function toSummary(device: VoiceDeviceEntity): VoiceDeviceSummary {
  return {
    id: device.id,
    deviceType: device.deviceType,
    displayName: device.displayName,
    status: device.status,
    firmwareVersion: device.firmwareVersion,
    lastSeenAt: device.lastSeenAt,
    createdAt: device.createdAt,
    connectionStatus: getVoiceDeviceConnectionStatus(
      device.lastSeenAt,
      device.status,
    ),
  };
}

function toRegistrationSummary(
  row: VoiceDeviceRegistrationEntity,
): VoiceDeviceRegistrationSummary {
  return {
    id: row.id,
    deviceType: row.deviceType,
    firmwareVersion: row.firmwareVersion,
    hardwareId: row.hardwareId,
    status: row.status,
    userId: row.userId,
    deviceId: row.deviceId,
    displayName: row.displayName,
    expiresAt: row.expiresAt,
    claimedAt: row.claimedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

export const pgVoiceDeviceRepository: VoiceDeviceRepository = {
  async listByUserId(userId) {
    const rows = await db
      .select()
      .from(VoiceDeviceTable)
      .where(
        and(
          eq(VoiceDeviceTable.userId, userId),
          eq(VoiceDeviceTable.status, "active"),
        ),
      )
      .orderBy(desc(VoiceDeviceTable.createdAt));
    return rows.map(toSummary);
  },

  async selectByTokenHash(tokenHash) {
    const [row] = await db
      .select({
        id: VoiceDeviceTable.id,
        userId: VoiceDeviceTable.userId,
        organizationId: VoiceDeviceTable.organizationId,
        deviceType: VoiceDeviceTable.deviceType,
        displayName: VoiceDeviceTable.displayName,
        status: VoiceDeviceTable.status,
      })
      .from(VoiceDeviceTable)
      .where(eq(VoiceDeviceTable.tokenHash, tokenHash));
    return row ?? null;
  },

  async selectByIdForUser(deviceId, userId) {
    const [row] = await db
      .select()
      .from(VoiceDeviceTable)
      .where(
        and(
          eq(VoiceDeviceTable.id, deviceId),
          eq(VoiceDeviceTable.userId, userId),
        ),
      );
    return row ? toSummary(row) : null;
  },

  async createDevice(input) {
    const [row] = await db
      .insert(VoiceDeviceTable)
      .values({
        userId: input.userId,
        organizationId: input.organizationId ?? null,
        deviceType: input.deviceType,
        displayName: input.displayName,
        tokenHash: input.tokenHash,
        firmwareVersion: input.firmwareVersion ?? null,
        status: "active",
      })
      .returning();
    return toSummary(row);
  },

  async revokeDevice(deviceId, userId) {
    const [row] = await db
      .delete(VoiceDeviceTable)
      .where(
        and(
          eq(VoiceDeviceTable.id, deviceId),
          eq(VoiceDeviceTable.userId, userId),
        ),
      )
      .returning({ id: VoiceDeviceTable.id });
    return !!row;
  },

  async touchLastSeen(deviceId) {
    await db
      .update(VoiceDeviceTable)
      .set({ lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(VoiceDeviceTable.id, deviceId));
  },

  async createPairingCode(input) {
    const [row] = await db
      .insert(VoiceDevicePairingCodeTable)
      .values({
        userId: input.userId,
        organizationId: input.organizationId ?? null,
        deviceType: input.deviceType,
        displayName: input.displayName ?? null,
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
      })
      .returning({
        id: VoiceDevicePairingCodeTable.id,
        expiresAt: VoiceDevicePairingCodeTable.expiresAt,
      });
    return row;
  },

  async consumePairingCode({ codeHash }) {
    const now = new Date();
    const [row] = await db
      .update(VoiceDevicePairingCodeTable)
      .set({ consumedAt: now })
      .where(
        and(
          eq(VoiceDevicePairingCodeTable.codeHash, codeHash),
          isNull(VoiceDevicePairingCodeTable.consumedAt),
          gt(VoiceDevicePairingCodeTable.expiresAt, now),
        ),
      )
      .returning({
        id: VoiceDevicePairingCodeTable.id,
        userId: VoiceDevicePairingCodeTable.userId,
        deviceType: VoiceDevicePairingCodeTable.deviceType,
        displayName: VoiceDevicePairingCodeTable.displayName,
        organizationId: VoiceDevicePairingCodeTable.organizationId,
      });
    return row ?? null;
  },

  async createDeviceRegistration(input) {
    const existing = await this.selectRegistrationByCodeHash(input.codeHash);
    if (
      existing &&
      existing.status === "pending" &&
      existing.expiresAt.getTime() > Date.now()
    ) {
      return existing;
    }

    if (existing) {
      const [row] = await db
        .update(VoiceDeviceRegistrationTable)
        .set({
          deviceType: input.deviceType,
          firmwareVersion: input.firmwareVersion ?? null,
          hardwareId: input.hardwareId ?? null,
          displayName: null,
          status: "pending",
          userId: null,
          organizationId: null,
          deviceId: null,
          deliveryToken: null,
          expiresAt: input.expiresAt,
          claimedAt: null,
          completedAt: null,
        })
        .where(eq(VoiceDeviceRegistrationTable.codeHash, input.codeHash))
        .returning();
      return toRegistrationSummary(row);
    }

    const [row] = await db
      .insert(VoiceDeviceRegistrationTable)
      .values({
        codeHash: input.codeHash,
        deviceType: input.deviceType,
        firmwareVersion: input.firmwareVersion ?? null,
        hardwareId: input.hardwareId ?? null,
        expiresAt: input.expiresAt,
        status: "pending",
      })
      .returning();
    return toRegistrationSummary(row);
  },

  async selectRegistrationByCodeHash(codeHash) {
    const [row] = await db
      .select()
      .from(VoiceDeviceRegistrationTable)
      .where(eq(VoiceDeviceRegistrationTable.codeHash, codeHash));
    return row ? toRegistrationSummary(row) : null;
  },

  async selectRegistrationById(registrationId) {
    const [row] = await db
      .select()
      .from(VoiceDeviceRegistrationTable)
      .where(eq(VoiceDeviceRegistrationTable.id, registrationId));
    return row ? toRegistrationSummary(row) : null;
  },

  async claimDeviceRegistration(input) {
    const now = new Date();
    const [row] = await db
      .update(VoiceDeviceRegistrationTable)
      .set({
        userId: input.userId,
        organizationId: input.organizationId ?? null,
        displayName: input.displayName,
        deviceId: input.deviceId,
        deliveryToken: input.deliveryToken,
        status: "claimed",
        claimedAt: now,
      })
      .where(
        and(
          eq(VoiceDeviceRegistrationTable.id, input.registrationId),
          eq(VoiceDeviceRegistrationTable.status, "pending"),
          gt(VoiceDeviceRegistrationTable.expiresAt, now),
        ),
      )
      .returning();
    return row ? toRegistrationSummary(row) : null;
  },

  async completeDeviceRegistration({ registrationId, codeHash }) {
    const now = new Date();
    const [pending] = await db
      .select()
      .from(VoiceDeviceRegistrationTable)
      .where(
        and(
          eq(VoiceDeviceRegistrationTable.id, registrationId),
          eq(VoiceDeviceRegistrationTable.codeHash, codeHash),
          eq(VoiceDeviceRegistrationTable.status, "claimed"),
          gt(VoiceDeviceRegistrationTable.expiresAt, now),
        ),
      );
    if (!pending?.deliveryToken) {
      return null;
    }

    const [row] = await db
      .update(VoiceDeviceRegistrationTable)
      .set({
        status: "completed",
        completedAt: now,
        deliveryToken: null,
      })
      .where(eq(VoiceDeviceRegistrationTable.id, registrationId))
      .returning();

    if (!row) {
      return null;
    }

    if (row.deviceId) {
      await db
        .update(VoiceDeviceTable)
        .set({ lastSeenAt: now, updatedAt: now })
        .where(eq(VoiceDeviceTable.id, row.deviceId));
    }

    return {
      registration: toRegistrationSummary(row),
      deliveryToken: pending.deliveryToken,
    };
  },
};

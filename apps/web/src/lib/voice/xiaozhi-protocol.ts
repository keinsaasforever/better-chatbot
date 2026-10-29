export const XIAOZHI_DEFAULT_SAMPLE_RATE = 16000;
export const XIAOZHI_DEFAULT_CHANNELS = 1;
export const XIAOZHI_DEFAULT_FRAME_DURATION_MS = 60;

export type XiaozhiHelloMessage = {
  type: "hello";
  version?: number;
  transport?: string;
  audio_params?: {
    format?: string;
    sample_rate?: number;
    channels?: number;
    frame_duration?: number;
  };
};

export type XiaozhiListenMessage = {
  type: "listen";
  session_id?: string;
  state?: "start" | "stop" | "detect";
  mode?: "auto" | "manual" | "realtime";
  text?: string;
};

export type XiaozhiClientMessage =
  | XiaozhiHelloMessage
  | XiaozhiListenMessage
  | {
      type?: string;
      session_id?: string;
      [key: string]: unknown;
    };

export type XiaozhiAudioFrame = {
  payload: Uint8Array;
  timestamp?: number;
};

export function parseXiaozhiTextMessage(data: string): XiaozhiClientMessage {
  const parsed = JSON.parse(data);
  return parsed && typeof parsed === "object" ? parsed : {};
}

export function parseXiaozhiAudioFrame(
  data: Uint8Array,
  protocolVersion: number,
): XiaozhiAudioFrame | null {
  if (protocolVersion === 2) {
    if (data.byteLength < 16) {
      return null;
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const type = view.getUint16(2, false);
    if (type !== 0) {
      return null;
    }
    const timestamp = view.getUint32(8, false);
    const payloadSize = view.getUint32(12, false);
    if (payloadSize <= 0 || payloadSize > data.byteLength - 16) {
      return null;
    }
    return {
      payload: data.slice(16, 16 + payloadSize),
      timestamp,
    };
  }

  if (protocolVersion === 3) {
    if (data.byteLength < 4 || data[0] !== 0) {
      return null;
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const payloadSize = view.getUint16(2, false);
    if (payloadSize <= 0 || payloadSize > data.byteLength - 4) {
      return null;
    }
    return {
      payload: data.slice(4, 4 + payloadSize),
    };
  }

  return data.byteLength > 0 ? { payload: data } : null;
}

export function createXiaozhiServerHello({
  sessionId,
  protocolVersion,
  sampleRate = XIAOZHI_DEFAULT_SAMPLE_RATE,
  channels = XIAOZHI_DEFAULT_CHANNELS,
  frameDurationMs = XIAOZHI_DEFAULT_FRAME_DURATION_MS,
}: {
  sessionId: string;
  protocolVersion: number;
  sampleRate?: number;
  channels?: number;
  frameDurationMs?: number;
}) {
  return {
    type: "hello",
    version: protocolVersion,
    transport: "websocket",
    session_id: sessionId,
    audio_params: {
      format: "opus",
      sample_rate: sampleRate,
      channels,
      frame_duration: frameDurationMs,
    },
  };
}

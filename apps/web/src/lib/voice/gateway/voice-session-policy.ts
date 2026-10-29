export type VoiceSessionMode = "voice_command" | "long_capture";

export type VoiceSessionPolicy = {
  mode: VoiceSessionMode;
  maxDurationMs: number;
  idleMs: number;
  autoEndSilenceMs: number | null;
  providerStreamRotateMs: number;
  runAiOnFinalize: boolean;
  allowToolExecution: boolean;
  ttsResponseEnabled: boolean;
};

function readMs(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getVoiceSessionPolicy(
  mode: VoiceSessionMode,
): VoiceSessionPolicy {
  if (mode === "long_capture") {
    return {
      mode,
      maxDurationMs: readMs("VOICE_SESSION_MAX_MS", 2 * 60 * 60 * 1000),
      idleMs: readMs("VOICE_SESSION_IDLE_MS", 5 * 60 * 1000),
      autoEndSilenceMs: null,
      providerStreamRotateMs: readMs(
        "VOICE_PROVIDER_STREAM_MAX_MS",
        30 * 60 * 1000,
      ),
      runAiOnFinalize: true,
      allowToolExecution: false,
      ttsResponseEnabled: false,
    };
  }

  return {
    mode,
    maxDurationMs: readMs("VOICE_COMMAND_MAX_MS", 2 * 60 * 1000),
    idleMs: readMs("VOICE_COMMAND_IDLE_MS", 15 * 1000),
    autoEndSilenceMs: readMs("VOICE_COMMAND_AUTO_END_MS", 4 * 1000),
    providerStreamRotateMs: readMs(
      "VOICE_PROVIDER_STREAM_MAX_MS",
      30 * 60 * 1000,
    ),
    runAiOnFinalize: true,
    allowToolExecution: true,
    ttsResponseEnabled: true,
  };
}

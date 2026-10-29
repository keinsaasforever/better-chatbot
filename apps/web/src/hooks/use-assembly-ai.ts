import {
  buildAssemblyAIStreamingUrl,
  preparePcmChunkForAssemblyAI,
} from "@/lib/assemblyai/streaming-config";
import { requireCredits } from "@/lib/billing/require-credits";
import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";

interface UseAssemblyAIProps {
  onTranscript: (text: string) => void;
  onCommand: (text: string) => void;
}

/**
 * Custom hook for AssemblyAI streaming speech-to-text
 * Uses secure token-based authentication via server endpoint
 */
export function useAssemblyAI({ onTranscript, onCommand }: UseAssemblyAIProps) {
  const [isListening, setIsListening] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionStartTimeRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastProcessedTurnOrderRef = useRef<number | null>(null);
  // Every start bumps the generation and every stop bumps it again, so a
  // start that is still awaiting the mic or the token can tell it was
  // cancelled and release what it acquired instead of resurrecting the
  // session. `activeRef` mirrors "mic is on or being requested" without the
  // render lag of state, so a tap while the socket is still connecting stops
  // instead of starting a second session on top of the first.
  const generationRef = useRef(0);
  const activeRef = useRef(false);

  const getMicrophoneStream = async (): Promise<MediaStream> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("MIC_NOT_SUPPORTED");
    }

    if (!window.isSecureContext) {
      throw new Error("MIC_INSECURE_CONTEXT");
    }

    // Best-effort preflight for browsers that support Permissions API.
    // On iOS Safari this may not exist, so we intentionally ignore errors.
    try {
      if ("permissions" in navigator) {
        const permissionStatus = await navigator.permissions.query({
          name: "microphone" as PermissionName,
        });

        if (permissionStatus.state === "denied") {
          throw new Error("MIC_PERMISSION_DENIED");
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === "MIC_PERMISSION_DENIED") {
        throw error;
      }
    }

    return navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        noiseSuppression: true,
        echoCancellation: true,
      },
    });
  };

  /**
   * Fetch temporary token from server endpoint
   */
  const fetchToken = async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/assemblyai/token", {
        method: "POST",
      });

      if (!response.ok) {
        if (response.status === 401) {
          toast.error("Please sign in to use voice dictation");
        } else {
          toast.error("Voice service unavailable");
        }
        return null;
      }

      const { token } = await response.json();
      return token;
    } catch (error) {
      console.error("Token fetch error:", error);
      toast.error("Failed to initialize voice service");
      return null;
    }
  };

  const stopRecording = useCallback(() => {
    // Calculate session duration BEFORE cleanup
    const sessionDuration = sessionStartTimeRef.current
      ? (Date.now() - sessionStartTimeRef.current) / 1000
      : 0;

    const sessionId = sessionIdRef.current;

    generationRef.current += 1;
    activeRef.current = false;

    // Cleanup audio processing
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (socketRef.current) {
      const socket = socketRef.current;
      socketRef.current = null;
      // Detach handlers first so the close does not re-enter stopRecording
      // or surface a "connection error" toast for a stop the user asked for.
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN) {
        // v3 API termination message format
        socket.send(JSON.stringify({ type: "Terminate" }));
      }
      // Also closes a socket that is still CONNECTING; otherwise it opens
      // later and the dictation looks alive again with no way to stop it.
      if (
        socket.readyState === WebSocket.CONNECTING ||
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close();
      }
    }

    const wasRecording = !!sessionId || sessionDuration > 0;

    setIsListening(false);

    if (wasRecording) {
      console.log(
        `AssemblyAI recording stopped (${sessionDuration.toFixed(2)}s)`,
      );
    }

    // Track usage asynchronously (fire-and-forget, don't block)
    // Only track sessions >= 1 second
    if (sessionId && sessionDuration >= 1) {
      fetch("/api/assemblyai/track-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          durationSeconds: sessionDuration,
        }),
      })
        .then(() => {
          console.log(
            `[AssemblyAI] Tracked ${sessionDuration.toFixed(2)}s usage`,
          );
        })
        .catch((error) => {
          console.error("Failed to track AssemblyAI usage:", error);
        });
    }

    // Reset session tracking
    sessionStartTimeRef.current = null;
    sessionIdRef.current = null;
    lastProcessedTurnOrderRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    const generation = ++generationRef.current;
    const isCancelled = () => generation !== generationRef.current;

    try {
      // Generate unique session ID for billing tracking
      const sessionId = `assemblyai-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      sessionIdRef.current = sessionId;
      lastProcessedTurnOrderRef.current = null;

      // Request microphone as the first async operation to maximize
      // mobile browser compatibility for user-gesture permission prompts.
      const stream = await getMicrophoneStream();
      if (isCancelled()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      // The mic is live from here on, so the button must already read as
      // "stop" even though the transcript socket is still connecting.
      setIsListening(true);

      // Fetch temporary token from server
      const token = await fetchToken();
      if (isCancelled()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (!token) {
        stopRecording();
        return;
      }

      // Start session timer (for billing)
      sessionStartTimeRef.current = Date.now();

      const socket = new WebSocket(buildAssemblyAIStreamingUrl({ token }));

      socket.onopen = () => {
        console.log("AssemblyAI WebSocket connected");
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        console.log("AssemblyAI message:", data);

        // Universal-3.6 Pro: one formatted final transcript per turn.
        //
        // We deliberately commit ONLY finalized, formatted turns. U3 Pro also
        // streams unformatted partials, but `onTranscript` appends into the
        // chat input, so replaying partials there would require the input to
        // own a "provisional text" region. How fast text appears is therefore
        // governed by AssemblyAI's endpointing, not by this gate — tune
        // ASSEMBLYAI_MIN/MAX_TURN_SILENCE_MS in lib/assemblyai/.
        if (
          data.type === "Turn" &&
          data.transcript &&
          data.end_of_turn === true &&
          data.turn_is_formatted !== false &&
          (data.turn_order == null ||
            data.turn_order !== lastProcessedTurnOrderRef.current)
        ) {
          if (data.turn_order != null) {
            lastProcessedTurnOrderRef.current = data.turn_order;
          }

          const text = data.transcript;

          // Auto-detect send commands in German
          if (
            text.toLowerCase().includes("senden") ||
            text.toLowerCase().includes("abschicken")
          ) {
            const cleanText = text.replace(/senden|abschicken/gi, "").trim();
            if (cleanText) {
              onCommand(cleanText);
            } else {
              onCommand("");
            }
          } else {
            onTranscript(text);
          }
        }
      };

      socket.onerror = (error) => {
        console.error("AssemblyAI WebSocket Error:", error);
        if (isCancelled()) return;
        stopRecording();
        toast.error("Voice connection error");
      };

      socket.onclose = () => {
        // The server ended the session: release the mic rather than leaving
        // it captured behind a button that no longer reads as recording.
        if (isCancelled()) return;
        stopRecording();
      };

      socketRef.current = socket;

      // Use the device-native sample rate and resample to 16 kHz before sending.
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      if (audioContext.sampleRate !== 16_000) {
        console.info(
          `[AssemblyAI] Resampling microphone audio from ${audioContext.sampleRate} Hz to 16000 Hz`,
        );
      }

      const source = audioContext.createMediaStreamSource(stream);

      // 4096 samples ≈ 85–256 ms depending on device sample rate (within 50–1000 ms).
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (socket.readyState === WebSocket.OPEN) {
          const float32Audio = e.inputBuffer.getChannelData(0);
          const pcmBuffer = preparePcmChunkForAssemblyAI(
            float32Audio,
            audioContext.sampleRate,
          );
          socket.send(pcmBuffer);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      console.error("Failed to start recording:", err);

      if (err instanceof Error) {
        if (err.message === "MIC_NOT_SUPPORTED") {
          toast.error("Microphone is not supported in this browser");
        } else if (err.message === "MIC_INSECURE_CONTEXT") {
          toast.error("Microphone access requires HTTPS");
        } else if (err.message === "MIC_PERMISSION_DENIED") {
          toast.error(
            "Microphone permission is blocked. Please allow it in browser settings.",
          );
        } else if (err.name === "NotAllowedError") {
          toast.error(
            "Microphone permission denied. Please allow microphone access.",
          );
        } else if (err.name === "NotFoundError") {
          toast.error("No microphone was found on this device");
        } else if (err.name === "NotReadableError") {
          toast.error(
            "Microphone is already in use by another app. Please close other recording apps and try again.",
          );
        } else {
          toast.error("Could not start voice dictation");
        }
      } else {
        toast.error("Could not start voice dictation");
      }

      if (!isCancelled()) stopRecording();
    }
  }, [onCommand, onTranscript, stopRecording]);

  const toggleListening = useCallback(() => {
    if (isListening || activeRef.current) {
      stopRecording();
    } else {
      // Only the start branch is gated; stopping must always work.
      if (!requireCredits()) return;
      startRecording();
    }
  }, [isListening, startRecording, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  return {
    isListening,
    toggleListening,
    stopRecording,
  };
}

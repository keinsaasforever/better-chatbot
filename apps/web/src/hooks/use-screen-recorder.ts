"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

interface UseScreenRecorderResult {
  isRecording: boolean;
  recordingSeconds: number;
  recordedFile: File | null;
  previewUrl: string | null;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  clearRecording: () => void;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
    return "video/webm;codecs=vp9";
  }
  if (MediaRecorder.isTypeSupported("video/webm")) {
    return "video/webm";
  }
  return undefined;
}

/**
 * Records the user's screen and yields a video File (WebM) for upload.
 */
export function useScreenRecorder(): UseScreenRecorderResult {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);

  const clearRecording = useCallback(() => {
    setRecordedFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setError(null);
  }, []);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      const msg = "Screen recording is not supported in this browser.";
      setError(msg);
      toast.error(msg);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });

      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;

        const blob = new Blob(chunksRef.current, {
          type: mimeType?.split(";")[0] ?? "video/webm",
        });
        chunksRef.current = [];

        if (blob.size === 0) {
          setError("Recording was empty.");
          return;
        }

        const name = `screen-recording-${Date.now()}.webm`;
        const file = new File([blob], name, { type: blob.type });
        setRecordedFile(file);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      };

      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        stopRecording();
      });

      secondsRef.current = 0;
      setRecordingSeconds(0);
      recorder.start(200);
      setIsRecording(true);

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setRecordingSeconds(secondsRef.current);
      }, 1000);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.name === "NotAllowedError"
            ? "Screen sharing was cancelled or denied."
            : e.message
          : "Could not start screen recording.";
      setError(msg);
      toast.error(msg);
      setIsRecording(false);
    }
  }, [stopRecording]);

  return {
    isRecording,
    recordingSeconds,
    recordedFile,
    previewUrl,
    error,
    startRecording,
    stopRecording,
    clearRecording,
  };
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { Button } from "ui/button";
import { cn } from "lib/utils";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { resolveHLSUrlCached } from "@/lib/utils/hls-url-resolver";
import { MediaResource } from "@/types/media";

interface VideoPlayerProps {
  media: MediaResource;
  className?: string;
  autoPlay?: boolean;
  controls?: boolean;
  onTimeUpdate?: (currentTime: number) => void;
  onError?: (error: Error) => void;
}

export function VideoPlayer({
  media,
  className,
  autoPlay = false,
  controls = true,
  onTimeUpdate,
  onError,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Extract video_id from media metadata or use media.url directly
  const videoId = media.metadata?.video_id || media.url;

  // Resolve HLS URL when component mounts
  useEffect(() => {
    const loadHLSUrl = async () => {
      try {
        setIsLoading(true);
        setError(null);

        let resolvedUrl: string;

        // If media.url is already an HLS URL, use it directly
        if (media.url.includes(".m3u8") || media.url.startsWith("http")) {
          resolvedUrl = media.url;
        } else {
          // Otherwise, resolve using video_id
          resolvedUrl = await resolveHLSUrlCached(videoId);
        }

        setHlsUrl(resolvedUrl);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load video";
        setError(errorMessage);
        onError?.(err instanceof Error ? err : new Error(errorMessage));
      } finally {
        setIsLoading(false);
      }
    };

    loadHLSUrl();
  }, [videoId, media.url, onError]);

  // Initialize HLS when URL is available
  useEffect(() => {
    if (!hlsUrl || !videoRef.current) return;

    const video = videoRef.current;

    // Check if HLS is supported
    if (Hls.isSupported()) {
      // Use HLS.js for browsers without native HLS support
      const hls = new Hls({
        enableWorker: false, // Disable worker for better compatibility
      });

      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        if (autoPlay) {
          video.play().catch(console.warn);
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error("HLS error:", data);
        if (data.fatal) {
          setError(`Video playback error: ${data.details}`);
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Use native HLS support (Safari)
      video.src = hlsUrl;
      setIsLoading(false);
      if (autoPlay) {
        video.play().catch(console.warn);
      }
    } else {
      setError("HLS is not supported in this browser");
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [hlsUrl, autoPlay]);

  // Video event handlers
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      const time = videoRef.current.currentTime;
      setCurrentTime(time);
      onTimeUpdate?.(time);
    }
  }, [onTimeUpdate]);
  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  }, []);

  // Control handlers
  const togglePlayPause = useCallback(() => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
  }, [isPlaying]);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;

    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;

    const time = parseFloat(e.target.value);
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!videoRef.current) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      videoRef.current.requestFullscreen();
    }
  }, []);

  // Format time display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Jump to start time if specified in metadata
  useEffect(() => {
    if (videoRef.current && media.metadata?.startTime && duration > 0) {
      videoRef.current.currentTime = media.metadata.startTime;
    }
  }, [media.metadata?.startTime, duration]);

  if (error) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center p-6 bg-card border rounded-lg text-center",
          className,
        )}
      >
        <AlertTriangle className="h-8 w-8 text-destructive mb-2" />
        <p className="text-sm text-muted-foreground mb-2">
          Failed to load video
        </p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative bg-black rounded-lg overflow-hidden group",
        className,
      )}
    >
      {/* Thumbnail overlay while loading */}
      {isLoading && media.thumbnail && (
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src={media.thumbnail}
            alt={media.title || "Video thumbnail"}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <Loader2 className="h-8 w-8 text-white animate-spin" />
          </div>
        </div>
      )}

      {/* Video element */}
      <video
        ref={videoRef}
        className="w-full h-auto"
        playsInline
        onPlay={handlePlay}
        onPause={handlePause}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        style={{ display: isLoading ? "none" : "block" }}
      />

      {/* Custom controls */}
      {controls && !isLoading && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Progress bar */}
          <div className="mb-3">
            <input
              type="range"
              min="0"
              max={duration || 0}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-1 bg-white/30 rounded-lg appearance-none cursor-pointer slider"
            />
            <div className="flex justify-between text-xs text-white mt-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Control buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                onClick={togglePlayPause}
                className="text-white hover:bg-white/20 h-8 w-8"
              >
                {isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>

              <Button
                size="icon"
                variant="ghost"
                onClick={toggleMute}
                className="text-white hover:bg-white/20 h-8 w-8"
              >
                {isMuted ? (
                  <VolumeX className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Video metadata */}
            <div className="flex items-center gap-4 text-xs text-white/80">
              {media.metadata?.confidence && (
                <span className="capitalize">
                  {media.metadata.confidence} confidence
                </span>
              )}
              {media.metadata?.score && (
                <span>{media.metadata.score.toFixed(1)}% match</span>
              )}
            </div>

            <Button
              size="icon"
              variant="ghost"
              onClick={toggleFullscreen}
              className="text-white hover:bg-white/20 h-8 w-8"
            >
              <Maximize className="h-4 w-4" />
            </Button>
          </div>

          {/* Transcription */}
          {media.metadata?.transcription && (
            <div className="mt-2 text-xs text-white/80 bg-black/50 p-2 rounded">
              "{media.metadata.transcription}"
            </div>
          )}
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && !media.thumbnail && (
        <div className="absolute inset-0 bg-black flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-white animate-spin" />
        </div>
      )}
    </div>
  );
}

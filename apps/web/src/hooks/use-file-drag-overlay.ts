import { useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";

type DragEventLike = DragEvent | ReactDragEvent;

const isFileDragDefault = (event: DragEventLike) => {
  const dataTransfer = event.dataTransfer ?? null;
  if (!dataTransfer) return false;
  if (dataTransfer.items && dataTransfer.items.length) {
    for (let i = 0; i < dataTransfer.items.length; i += 1) {
      if (dataTransfer.items[i]?.kind === "file") {
        return true;
      }
    }
    return false;
  }
  const types = Array.from(dataTransfer.types ?? []);
  return types.includes("Files");
};

interface UseFileDragOverlayOptions {
  onDropFiles?: (files: File[]) => void | Promise<void>;
  isFileDrag?: (event: DragEventLike) => boolean;
}

export const useFileDragOverlay = ({
  onDropFiles,
  isFileDrag = isFileDragDefault,
}: UseFileDragOverlayOptions = {}) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const dropHandlerRef = useRef(onDropFiles);
  const isFileDragRef = useRef(isFileDrag);

  useEffect(() => {
    dropHandlerRef.current = onDropFiles;
  }, [onDropFiles]);

  useEffect(() => {
    isFileDragRef.current = isFileDrag;
  }, [isFileDrag]);

  useEffect(() => {
    const handleDragEnter = (event: DragEvent) => {
      if (!isFileDragRef.current(event)) return;
      event.preventDefault();
      dragCounter.current += 1;
      setIsDragging(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!isFileDragRef.current(event)) return;
      event.preventDefault();
      try {
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "copy";
        }
      } catch {
        // no-op — some browsers throw when setting dropEffect
      }
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!isFileDragRef.current(event)) return;
      event.preventDefault();
      dragCounter.current = Math.max(0, dragCounter.current - 1);
      if (dragCounter.current === 0) {
        setIsDragging(false);
      }
    };

    const handleDrop = async (event: DragEvent) => {
      if (!isFileDragRef.current(event)) return;
      event.preventDefault();
      event.stopPropagation();
      dragCounter.current = 0;
      setIsDragging(false);

      if (!dropHandlerRef.current) return;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      try {
        await dropHandlerRef.current(files);
      } catch {
        // Allow caller to surface errors separately
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, []);

  return { isDragging };
};

export const isFileDragEvent = isFileDragDefault;

"use client";

import { Loader2, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";

const MIN_BRUSH = 8;
const MAX_BRUSH = 160;
const DEFAULT_BRUSH = 48;
const MAX_UNDO = 10;
/**
 * Cap on the mask canvas's long edge.
 *
 * The undo stack holds full `ImageData` snapshots — four bytes per pixel — so
 * a 24 MP phone photo would cost ~96 MB per stroke and take the tab down. The
 * mask does not need the photo's native pixels: the server scales the pair to
 * one size before sending it, so anything above the model's working
 * resolution is thrown away regardless.
 */
const MAX_MASK_EDGE = 1536;
/** What the visitor sees while painting; the exported mask is pure white. */
const STROKE_COLOR = "rgba(239, 68, 68, 0.55)";

interface ImageMaskEditorProps {
  open: boolean;
  imageUrl: string;
  imageName: string;
  /** True while the parent uploads the exported mask. */
  applying?: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the mask PNG: white where the photo may change, black elsewhere. */
  onApply: (mask: File) => void | Promise<void>;
}

/**
 * Brush-mask editor for inpainting. The photo is shown as a plain `<img>` and
 * the strokes live on a transparent canvas laid over it, sized to the photo's
 * natural pixels up to `MAX_MASK_EDGE`. The photo is never drawn into the
 * canvas, so a cross-origin storage URL cannot taint it and export always
 * works.
 */
export function ImageMaskEditor({
  open,
  imageUrl,
  imageName,
  applying = false,
  onOpenChange,
  onApply,
}: ImageMaskEditorProps) {
  const t = useTranslations("Chat.MaskEditor");
  const tCommon = useTranslations("Common");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH);
  const [ready, setReady] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [undoDepth, setUndoDepth] = useState(0);

  const resetCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !image.naturalWidth || !image.naturalHeight)
      return;
    const scale = Math.min(
      1,
      MAX_MASK_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
    );
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    undoStackRef.current = [];
    setUndoDepth(0);
    setHasStrokes(false);
  }, []);

  // A fresh open is a fresh mask; a stale one from the previous photo would
  // otherwise be exported against the wrong pixels.
  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }
    setBrushSize(DEFAULT_BRUSH);
  }, [open]);

  const onImageLoad = () => {
    resetCanvas();
    setReady(true);
  };

  /** Pointer position in canvas pixels, whatever size the canvas renders at. */
  const toCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
      scale: canvas.width / rect.width,
    };
  };

  const paint = (
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    width: number,
  ) => {
    ctx.strokeStyle = STROKE_COLOR;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready || applying) return;
    const canvas = event.currentTarget;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_UNDO - 1)),
      snapshot,
    ];
    setUndoDepth(undoStackRef.current.length);
    const point = toCanvasPoint(event);
    drawingRef.current = true;
    lastPointRef.current = point;
    // A tap without movement still leaves a dot.
    paint(ctx, point, point, brushSize * point.scale);
    setHasStrokes(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = event.currentTarget.getContext("2d");
    const last = lastPointRef.current;
    if (!ctx || !last) return;
    const point = toCanvasPoint(event);
    paint(ctx, last, point, brushSize * point.scale);
    lastPointRef.current = point;
  };

  const endStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const undo = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const snapshot = undoStackRef.current.pop();
    if (!canvas || !ctx || !snapshot) return;
    ctx.putImageData(snapshot, 0, 0);
    setUndoDepth(undoStackRef.current.length);
    if (undoStackRef.current.length === 0) setHasStrokes(false);
  };

  const exportMask = (): Promise<File | null> =>
    new Promise((resolve) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return resolve(null);

      const painted = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const mask = document.createElement("canvas");
      mask.width = canvas.width;
      mask.height = canvas.height;
      const maskCtx = mask.getContext("2d");
      if (!maskCtx) return resolve(null);
      const out = maskCtx.createImageData(mask.width, mask.height);
      // Any painted pixel becomes white; the inpainting models read white
      // as "regenerate here" and black as "keep".
      for (let i = 0; i < painted.data.length; i += 4) {
        const on = painted.data[i + 3]! > 0 ? 255 : 0;
        out.data[i] = on;
        out.data[i + 1] = on;
        out.data[i + 2] = on;
        out.data[i + 3] = 255;
      }
      maskCtx.putImageData(out, 0, 0);
      mask.toBlob((blob) => {
        if (!blob) return resolve(null);
        const base = imageName.replace(/\.[^.]+$/, "") || "image";
        resolve(new File([blob], `mask-${base}.png`, { type: "image/png" }));
      }, "image/png");
    });

  const apply = async () => {
    const file = await exportMask();
    if (!file) return;
    await onApply(file);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !applying && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-4xl max-h-[92vh] flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>

        <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden rounded-lg bg-muted/40">
          <div className="relative inline-block max-w-full max-h-[60vh]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={imageUrl}
              alt={imageName}
              onLoad={onImageLoad}
              draggable={false}
              className="block max-w-full max-h-[60vh] object-contain select-none"
            />
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onPointerLeave={endStroke}
              className="absolute inset-0 w-full h-full touch-none cursor-crosshair"
              aria-label={t("canvasLabel")}
            />
          </div>
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{t("brushSize")}</span>
            <input
              type="range"
              min={MIN_BRUSH}
              max={MAX_BRUSH}
              value={brushSize}
              onChange={(event) => setBrushSize(Number(event.target.value))}
              disabled={applying}
              className="w-40 accent-primary"
            />
          </label>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={undoDepth === 0 || applying}
            >
              <Undo2 className="size-4" />
              {t("undo")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetCanvas}
              disabled={!hasStrokes || applying}
            >
              {t("clear")}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={applying}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={apply}
            disabled={!ready || !hasStrokes || applying}
          >
            {applying && <Loader2 className="size-4 animate-spin" />}
            {applying ? t("applying") : t("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { notify } from "lib/notify";
import { MCPImageInfo } from "lib/utils/mcp-media-parser";

interface MCPImageGalleryProps {
  images: MCPImageInfo[];
}

export function MCPImageGallery({ images }: MCPImageGalleryProps) {
  const [errorSrc, setErrorSrc] = useState<string[]>([]);

  const onError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const target = e.currentTarget;
    if (errorSrc.includes(target.src)) return;
    setErrorSrc([...errorSrc, target.src]);
  };

  // Filter out images that failed to load
  const validImages = images.filter((image) => !errorSrc.includes(image.url));

  if (validImages.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {validImages.map((image, i) => {
        if (!image.url) return null;
        return (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <div
                key={image.url}
                onClick={() => {
                  notify.component({
                    className: "max-w-[90vw]! max-h-[90vh]! p-6!",
                    children: (
                      <div className="flex flex-col h-full gap-4">
                        <div className="flex-1 flex items-center justify-center min-h-0 py-6">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={image.url}
                            className="max-w-[80vw] max-h-[80vh] object-contain rounded-lg"
                            alt={image.description}
                            onError={onError}
                          />
                        </div>
                        {image.description && (
                          <div className="text-center text-sm text-muted-foreground">
                            {image.description}
                          </div>
                        )}
                      </div>
                    ),
                  });
                }}
                className="block shadow rounded-lg overflow-hidden ring ring-input cursor-pointer hover:ring-primary/50 transition-all duration-200"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  loading="lazy"
                  src={image.url}
                  alt={image.description}
                  className="w-full h-36 object-cover hover:scale-105 transition-transform duration-300"
                  onError={onError}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent className="p-4 max-w-xs whitespace-pre-wrap break-words">
              <p className="text-xs text-muted-foreground">
                {image.description || image.url}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

"use client";

import { errorToString } from "lib/utils";
import { toast } from "sonner";
import JsonView from "ui/json-view";

export const notImplementedToast = () => {
  toast.warning(
    <div className="flex gap-2 flex-col">
      <span className="font-semibold">Not implemented yet 🤣</span>
      <span className="text-xs text-muted-foreground">
        (This feature is coming soon)
      </span>
    </div>,
  );
};

export const handleErrorWithToast = (error: Error, id?: string) => {
  toast.error(`${error?.name || "Error"}`, {
    description: (
      <div className="my-4 max-h-[340px] overflow-y-auto">
        <JsonView data={errorToString(error)} />
      </div>
    ),
    id,
  });

  return error;
};

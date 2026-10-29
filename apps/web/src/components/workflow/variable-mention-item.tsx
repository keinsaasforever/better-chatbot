import { cn } from "lib/utils";
import { TriangleAlertIcon, VariableIcon, XIcon } from "lucide-react";

export function VariableMentionItem({
  nodeName,
  path,
  notFound,
  onRemove,
  className,
  type,
}: {
  nodeName: string;
  path: string[];
  notFound?: boolean;
  onRemove?: () => void;
  className?: string;
  type?: string;
}) {
  return (
    <div
      className={cn(
        notFound ? "hover:ring-destructive" : "hover:ring-blue-500",
        "ring ring-border gap-1 flex items-center text-xs px-2 py-1 rounded-sm bg-background",
        className,
      )}
    >
      {notFound ? (
        <TriangleAlertIcon className="text-destructive size-2.5" />
      ) : (
        <VariableIcon className="text-blue-500 size-2.5" />
      )}
      {type ? (
        <span className="text-muted-foreground text-xs">{type}</span>
      ) : null}
      <span>{nodeName}/</span>

      <span
        className={cn(
          notFound ? "text-destructive" : "text-blue-500",
          "min-w-0 truncate flex-1",
        )}
      >
        {path.join(".")}
      </span>
      {onRemove ? (
        <XIcon
          className="text-muted-foreground size-2.5 cursor-pointer"
          onClick={onRemove}
        />
      ) : null}
    </div>
  );
}

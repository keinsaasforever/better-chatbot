import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "./table";
import { cn } from "lib/utils";

// Sort icon component
interface SortIconProps {
  field: string;
  currentSortBy: string;
  currentSortDirection: "asc" | "desc";
}

function SortIcon({
  field,
  currentSortBy,
  currentSortDirection,
}: SortIconProps) {
  if (currentSortBy !== field) {
    return <ArrowUpDown className="h-4 w-4 text-muted-foreground" />;
  }

  return currentSortDirection === "asc" ? (
    <ArrowUp className="h-4 w-4 text-foreground" />
  ) : (
    <ArrowDown className="h-4 w-4 text-foreground" />
  );
}

// Sortable table header component
interface SortableHeaderProps {
  field: string;
  children: React.ReactNode;
  currentSortBy: string;
  currentSortDirection: "asc" | "desc";
  onSort: (field: string) => void;
  className?: string;
  "data-testid"?: string;
}

export function SortableHeader({
  field,
  children,
  currentSortBy,
  currentSortDirection,
  onSort,
  className = "",
  "data-testid": testId,
}: SortableHeaderProps) {
  return (
    <TableHead
      className={cn(
        "font-semibold cursor-pointer hover:bg-muted/50 transition-colors",
        className,
      )}
      role="columnheader"
      tabIndex={0}
      aria-sort={
        currentSortBy === field
          ? currentSortDirection === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      onClick={() => onSort(field)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSort(field);
        }
      }}
      data-testid={testId}
    >
      <div className="flex items-center gap-2">
        {children}
        <SortIcon
          field={field}
          currentSortBy={currentSortBy}
          currentSortDirection={currentSortDirection}
        />
      </div>
    </TableHead>
  );
}

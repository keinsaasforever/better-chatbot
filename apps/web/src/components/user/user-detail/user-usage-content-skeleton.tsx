import { UserStatsCardLoaderSkeleton } from "./user-stats-card-loader";
import { Skeleton } from "ui/skeleton";

export function UserUsageContentSkeleton() {
  return (
    <div className="min-h-full p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-5 w-64" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>

      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-4 w-48" />
      </div>

      <UserStatsCardLoaderSkeleton />
    </div>
  );
}

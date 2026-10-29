import { UserDetailFormSkeleton } from "./user-detail-form-skeleton";
import { UserAccessCardSkeleton } from "./user-access-card-skeleton";
import { UserStatsCardLoaderSkeleton } from "./user-stats-card-loader";
import { Skeleton } from "ui/skeleton";

export function UserDetailContentSkeleton() {
  return (
    <div className="min-h-full p-4 md:p-6 space-y-6">
      {/* Hero Section */}
      <div className="space-y-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-80" />
      </div>

      {/* Cards Layout */}
      <div className="space-y-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
        <UserDetailFormSkeleton />
        <UserAccessCardSkeleton />

        {/* Full Width Statistics */}
        <div className="col-span-2">
          <UserStatsCardLoaderSkeleton />
        </div>
      </div>
    </div>
  );
}

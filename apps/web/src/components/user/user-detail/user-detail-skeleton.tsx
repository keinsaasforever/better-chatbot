import { UserDetailFormSkeleton } from "./user-detail-form-skeleton";
import { UserAccessCardSkeleton } from "./user-access-card-skeleton";
import { UserStatsCardLoaderSkeleton } from "./user-stats-card-loader";

export function UserDetailSkeleton() {
  return (
    <div className="p-6">
      {/* Page Header */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Admin</span>
              <span>/</span>
              <span>Users</span>
              <span>/</span>
              <span>User Details</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cards Layout */}
      <div className="space-y-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Top Row: User Details Form & Access & Account */}
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

import { getUserStats } from "lib/user/server";
import { UserStatisticsCard } from "./user-statistics-card";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Skeleton } from "ui/skeleton";

export const UserStatsCardLoader = async ({
  userId,
  view = "admin",
}: {
  userId: string;
  view?: "admin" | "user";
}) => {
  const userStats = await getUserStats(userId);
  return (
    <UserStatisticsCard
      stats={{ ...userStats, period: "Last 30 Days" }}
      view={view}
    />
  );
};

export const UserStatsCardLoaderSkeleton = () => {
  return (
    <Card className="transition-all duration-200 hover:shadow-md">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-6 w-32" />
        </CardTitle>
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-48" />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Main Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-4">
          {/* Total Tokens - spans 2 columns */}
          <div className="rounded-lg border p-3 bg-primary/10 col-span-2">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-primary/10 shrink-0">
                <Skeleton className="h-4 w-4" />
              </div>
              <div>
                <Skeleton className="h-3 w-20 mb-1" />
                <Skeleton className="h-6 w-16" />
              </div>
            </div>
          </div>

          {/* Models Used */}
          <div className="rounded-lg border p-3 bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-muted shrink-0">
                <Skeleton className="h-4 w-4" />
              </div>
              <div>
                <Skeleton className="h-3 w-12 mb-1" />
                <Skeleton className="h-6 w-6" />
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="rounded-lg border p-3 bg-muted/30">
            <div className="flex items-center gap-3">
              <div className="rounded-full p-2 bg-muted shrink-0">
                <Skeleton className="h-4 w-4" />
              </div>
              <div>
                <Skeleton className="h-3 w-16 mb-1" />
                <Skeleton className="h-6 w-8" />
              </div>
            </div>
          </div>
        </div>

        {/* Top Models by Token Usage */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-40" />
          </h4>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Pie Chart Skeleton */}
            <div className="min-h-[300px]">
              <div className="rounded-lg border bg-background/50 p-4">
                <div className="flex items-center justify-between mb-4">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-4 w-4" />
                </div>
                <div className="flex items-center justify-center">
                  <Skeleton className="h-48 w-48 rounded-full" />
                </div>
              </div>
            </div>

            {/* Model List Skeleton */}
            <div className="space-y-2">
              <Skeleton className="h-4 w-32 mb-3" />
              <div className="max-h-[280px] overflow-y-auto pr-2 space-y-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 rounded-lg bg-background/50 border"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {index < 3 && <Skeleton className="h-5 w-6 rounded" />}
                        <Skeleton className="h-4 w-4 shrink-0" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <Skeleton className="h-4 w-20 mb-1" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </div>
                    <Skeleton className="h-4 w-12 shrink-0 ml-3" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 p-3 text-center">
            <Skeleton className="h-3 w-20 mx-auto mb-1" />
            <Skeleton className="h-5 w-8 mx-auto" />
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 text-center">
            <Skeleton className="h-3 w-24 mx-auto mb-1" />
            <Skeleton className="h-5 w-12 mx-auto" />
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 text-center">
            <Skeleton className="h-3 w-16 mx-auto mb-1" />
            <div className="flex items-center justify-center gap-1">
              <Skeleton className="h-3 w-3" />
              <Skeleton className="h-5 w-16" />
            </div>
          </div>
        </div>

        {/* Summary/Insights */}
        <div className="rounded-lg bg-primary/5 p-3">
          <div className="space-y-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

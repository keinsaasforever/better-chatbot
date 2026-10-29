import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "ui/table";
import { Input } from "ui/input";
import { Search, ChevronRight } from "lucide-react";
import { Skeleton } from "ui/skeleton";
import { Avatar, AvatarFallback } from "ui/avatar";

export function UsersTableSkeleton() {
  // Generate reasonable number of skeleton rows
  const skeletonRows = Array.from({ length: 8 }, (_, i) => i);

  return (
    <div className="space-y-4 w-full">
      {/* Search Bar Section */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            className="pl-9"
            disabled
          />
        </div>
        {/* Total count skeleton */}
        <div className="text-sm text-muted-foreground">
          <Skeleton className="h-4 w-16" />
        </div>
      </div>

      {/* Table Section */}
      <div className="rounded-lg border bg-card w-full overflow-x-auto">
        <Table data-testid="users-table-skeleton" className="w-full">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-semibold w-1/2">User</TableHead>
              <TableHead className="font-semibold w-32">Role</TableHead>
              <TableHead className="font-semibold w-24">Status</TableHead>
              <TableHead className="font-semibold w-32">Joined</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skeletonRows.map((index) => (
              <TableRow key={index}>
                {/* User Column */}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback>
                        <Skeleton className="h-full w-full rounded-full" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="space-y-1 min-w-0 flex-1">
                      <Skeleton
                        className={`h-4 ${index % 3 === 0 ? "w-32" : index % 3 === 1 ? "w-48" : "w-40"}`}
                      />
                      <Skeleton
                        className={`h-3 ${index % 4 === 0 ? "w-56" : index % 4 === 1 ? "w-72" : index % 4 === 2 ? "w-64" : "w-60"}`}
                      />
                    </div>
                  </div>
                </TableCell>

                {/* Role Column */}
                <TableCell>
                  <div className="flex gap-1">
                    <Skeleton
                      className={`h-5 rounded-full ${index % 4 === 0 ? "w-16" : index % 4 === 1 ? "w-20" : index % 4 === 2 ? "w-16" : "w-20"}`}
                    />
                    {/* Sometimes show a second role badge */}
                    {index % 3 === 0 && (
                      <Skeleton className="h-5 w-14 rounded-full" />
                    )}
                  </div>
                </TableCell>

                {/* Status Column */}
                <TableCell>
                  <Skeleton
                    className={`h-5 rounded-full ${index % 3 === 0 ? "w-18" : index % 3 === 1 ? "w-14" : "w-16"}`}
                  />
                </TableCell>

                {/* Joined Column */}
                <TableCell>
                  <Skeleton
                    className={`h-4 ${index % 2 === 0 ? "w-28" : "w-32"}`}
                  />
                </TableCell>

                {/* Arrow Column */}
                <TableCell>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Section */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-20" />
        </div>
        <div className="text-sm text-muted-foreground">
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    </div>
  );
}

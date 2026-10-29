"use client";

import { useTransition, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "ui/table";
import { Badge } from "ui/badge";
import { Input } from "ui/input";
import { buttonVariants } from "ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Search, ChevronRight, X } from "lucide-react";

import { AdminUserListItem } from "app-types/admin";
import { cn } from "lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { TablePagination } from "ui/table-pagination";
import Form from "next/form";
import Link from "next/link";
import { SortableHeader } from "ui/sortable-header";
import { getUserAvatar } from "lib/user/utils";
import { useTranslations } from "next-intl";
import { UserRoleBadges } from "@/components/user/user-detail/user-role-badges";
import { UserStatusBadge } from "@/components/user/user-detail/user-status-badge";
import { buildUserDetailUrl } from "@/lib/admin/navigation-utils";

const DEFAULT_SORT_BY = "createdAt";
const DEFAULT_SORT_DIRECTION = "desc";

interface UsersTableProps {
  users: AdminUserListItem[];
  currentUserId: string;
  total: number;
  page: number;
  limit: number;
  query?: string;
  baseUrl?: string;
  sortBy: string;
  sortDirection: "asc" | "desc";
}

export function UsersTable({
  users,
  currentUserId,
  total,
  page,
  limit,
  query,
  baseUrl = "/admin/users",
  sortBy = DEFAULT_SORT_BY,
  sortDirection = DEFAULT_SORT_DIRECTION,
}: UsersTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [_, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useTranslations("Admin.Users");
  const shouldAutoFocusRef = useRef<boolean>(false);

  const submitForm = useCallback(() => {
    // Track that we're about to submit and should maintain focus
    formRef.current?.requestSubmit();
  }, []);

  const debouncedSetUrlQuery = useDebounce(submitForm, 300);

  const totalPages = Math.ceil(total / limit);

  const buildUrl = useCallback(
    (
      params: {
        page?: number;
        sortBy?: string;
        sortDirection?: "asc" | "desc";
        query?: string;
      } = {},
    ) => {
      const searchParams = new URLSearchParams();

      // Use provided values or fall back to current values
      const finalPage = params.page ?? page;
      const finalSortBy = params.sortBy ?? sortBy;
      const finalSortDirection = params.sortDirection ?? sortDirection;
      const finalQuery = params.query ?? query;

      // Only add non-default values to keep URLs clean
      if (finalPage && finalPage !== 1) {
        searchParams.set("page", finalPage.toString());
      }
      if (finalSortBy && finalSortBy !== DEFAULT_SORT_BY) {
        searchParams.set("sortBy", finalSortBy);
      }
      if (finalSortDirection && finalSortDirection !== DEFAULT_SORT_DIRECTION) {
        searchParams.set("sortDirection", finalSortDirection);
      }
      if (finalQuery) {
        searchParams.set("query", finalQuery);
      }

      const queryString = searchParams.toString();
      return queryString ? `${baseUrl}?${queryString}` : baseUrl;
    },
    [baseUrl, page, sortBy, sortDirection, query],
  );

  const handleSort = useCallback(
    (field: string) => {
      const newSortDirection =
        sortBy === field && sortDirection === "asc" ? "desc" : "asc";

      router.push(
        buildUrl({
          sortBy: field,
          sortDirection: newSortDirection,
          page: 1,
        }),
      );
    },
    [sortBy, sortDirection, router, buildUrl],
  );

  const handleRowClick = (userId: string) => {
    startTransition(() => {
      // Get current search params as string
      const currentSearchString = searchParams.toString();
      const url = buildUserDetailUrl(userId, currentSearchString);
      router.push(url);
    });
  };

  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Form action={baseUrl} ref={formRef}>
            {page !== 1 && <input type="hidden" name="page" value={1} />}
            {sortBy !== DEFAULT_SORT_BY && (
              <input type="hidden" name="sortBy" value={sortBy} />
            )}
            {sortDirection !== DEFAULT_SORT_DIRECTION && (
              <input type="hidden" name="sortDirection" value={sortDirection} />
            )}
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              autoFocus={shouldAutoFocusRef.current}
              key={query ?? "empty"}
              placeholder={t("searchPlaceholder")}
              className="pl-9"
              name="query"
              defaultValue={query}
              onFocus={() => {
                shouldAutoFocusRef.current = true;
              }}
              onChange={() => {
                debouncedSetUrlQuery();
              }}
              data-testid="users-search-input"
            />
          </Form>
        </div>
        {(query ||
          sortBy !== DEFAULT_SORT_BY ||
          sortDirection !== DEFAULT_SORT_DIRECTION) && (
          <Link
            href={baseUrl}
            className={cn("shrink-0", buttonVariants({ variant: "outline" }))}
          >
            <X className="h-4 w-4 mr-1" />
            {t("clear")}
          </Link>
        )}
        <div
          className="text-sm text-muted-foreground"
          data-testid="users-total-count"
        >
          {t("totalCount", { count: total })}
        </div>
      </div>

      <div className="rounded-lg border bg-card w-full overflow-x-auto">
        <Table data-testid="users-table" className="w-full">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHeader
                field="name"
                currentSortBy={sortBy}
                currentSortDirection={sortDirection}
                onSort={handleSort}
                data-testid="sort-header-name"
              >
                <span className="px-2">{t("user")}</span>
              </SortableHeader>
              <SortableHeader
                field="role"
                currentSortBy={sortBy}
                currentSortDirection={sortDirection}
                onSort={handleSort}
                data-testid="sort-header-role"
              >
                {t("role")}
              </SortableHeader>
              <TableHead className="font-semibold" data-testid="header-status">
                {t("status")}
              </TableHead>
              <SortableHeader
                field="createdAt"
                currentSortBy={sortBy}
                currentSortDirection={sortDirection}
                onSort={handleSort}
                data-testid="sort-header-createdAt"
              >
                {t("joined")}
              </SortableHeader>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center py-8 text-muted-foreground"
                >
                  {t("noUsersFound")}
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow
                  key={user.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleRowClick(user.id)}
                  data-testid={`user-row-${user.id}`}
                >
                  <TableCell>
                    <div className="flex items-center gap-3 px-2">
                      <Avatar className="size-8 rounded-full">
                        <AvatarImage src={getUserAvatar(user)} />
                        <AvatarFallback className="text-sm">
                          {user.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {user.name}
                          {user.id === currentUserId && (
                            <Badge
                              variant="outline"
                              className="text-xs"
                              data-testid="current-user-badge"
                            >
                              {t("youBadge")}
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <UserRoleBadges
                      user={{ ...user }}
                      showBanned={false}
                      className="mt-0"
                    />
                  </TableCell>
                  <TableCell>
                    <UserStatusBadge
                      user={{ ...user, lastLogin: user.lastLogin || null }}
                      currentUserId={currentUserId}
                      showClickable={false}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(user.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    <ChevronRight
                      className="h-4 w-4 text-muted-foreground"
                      data-testid="user-row-chevron"
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        currentPage={page}
        totalPages={totalPages}
        buildUrl={buildUrl}
      />
    </div>
  );
}

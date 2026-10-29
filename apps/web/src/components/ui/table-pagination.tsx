import { cn } from "lib/utils";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "ui/pagination";

interface TablePaginationProps {
  currentPage: number;
  totalPages: number;
  buildUrl: (params: { page: number }) => string;
  className?: string;
}

export function TablePagination({
  currentPage,
  totalPages,
  buildUrl,
  className,
}: TablePaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <Pagination className={className} data-testid="table-pagination">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href={currentPage > 1 ? buildUrl({ page: currentPage - 1 }) : "#"}
            className={cn(currentPage <= 1 && "pointer-events-none opacity-50")}
          />
        </PaginationItem>

        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
          let pageNum;
          if (totalPages <= 5) {
            pageNum = i + 1;
          } else if (currentPage <= 3) {
            pageNum = i + 1;
          } else if (currentPage >= totalPages - 2) {
            pageNum = totalPages - 4 + i;
          } else {
            pageNum = currentPage - 2 + i;
          }

          return (
            <PaginationItem key={pageNum}>
              <PaginationLink
                href={buildUrl({ page: pageNum })}
                isActive={pageNum === currentPage}
              >
                {pageNum}
              </PaginationLink>
            </PaginationItem>
          );
        })}

        {totalPages > 5 && currentPage < totalPages - 2 && (
          <PaginationItem>
            <PaginationEllipsis />
          </PaginationItem>
        )}

        <PaginationItem>
          <PaginationNext
            href={
              currentPage < totalPages
                ? buildUrl({ page: currentPage + 1 })
                : "#"
            }
            className={cn(
              currentPage >= totalPages && "pointer-events-none opacity-50",
            )}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

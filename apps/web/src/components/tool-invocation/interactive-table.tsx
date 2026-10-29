"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import {
  ArrowDownUp,
  Download,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileSpreadsheet,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { JsonViewPopup } from "../json-view-popup";
import { Checkbox } from "ui/checkbox";

// Column configuration interface
interface Column {
  key: string;
  label: string;
  type?: "string" | "number" | "date" | "boolean";
}

// Table component props interface
export interface InteractiveTableProps {
  title: string;
  description?: string;
  columns: Column[];
  data: Array<Record<string, any>>;
}

// Sort direction type
type SortDirection = "asc" | "desc" | null;

// Lazy load XLSX library from CDN
const loadXLSX = async () => {
  if (typeof window === "undefined") {
    throw new Error("XLSX can only be loaded in browser environment");
  }

  // Check if XLSX is already loaded
  if ((window as any).XLSX) {
    return (window as any).XLSX;
  }

  // Load XLSX from CDN
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
    script.onload = () => {
      if ((window as any).XLSX) {
        resolve((window as any).XLSX);
      } else {
        reject(new Error("Failed to load XLSX library"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load XLSX script"));
    document.head.appendChild(script);
  });
};

export function InteractiveTable(props: InteractiveTableProps) {
  const { title, data, columns, description } = props;

  // Fixed settings for simplicity
  const pageSize = 20;
  const searchable = true;
  const exportable = true;

  // State management
  const [searchTerm, setSearchTerm] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(columns.map((col) => col.key)),
  );

  // Helper function to format cell values based on column type
  const formatCellValue = (value: any, columnType: string = "string") => {
    if (value === null || value === undefined) return "";

    switch (columnType) {
      case "number":
        return typeof value === "number" ? value.toLocaleString() : value;
      case "boolean":
        return value ? "Yes" : "No";
      case "date":
        try {
          return new Date(value).toLocaleDateString();
        } catch {
          return value;
        }
      default:
        return String(value);
    }
  };

  // Highlight search terms in text
  const highlightText = (text: string, searchTerm: string) => {
    if (!searchTerm || !text) return text;

    const regex = new RegExp(`(${searchTerm})`, "gi");
    const parts = String(text).split(regex);

    return parts.map((part, index) =>
      regex.test(part) ? (
        <mark key={index} className="bg-yellow-200 dark:bg-yellow-800">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  // Filter and sort data
  const processedData = useMemo(() => {
    let filtered = [...data];

    // Apply global search
    if (searchTerm && searchable) {
      filtered = filtered.filter((row) =>
        Object.values(row).some((value) =>
          String(value).toLowerCase().includes(searchTerm.toLowerCase()),
        ),
      );
    }

    // Apply sorting based on column type
    if (sortColumn && sortDirection) {
      filtered.sort((a, b) => {
        const aValue = a[sortColumn];
        const bValue = b[sortColumn];
        const column = columns.find((col) => col.key === sortColumn);
        const columnType = column?.type || "string";

        let comparison = 0;

        switch (columnType) {
          case "number":
            comparison = Number(aValue || 0) - Number(bValue || 0);
            break;
          case "date":
            comparison =
              new Date(aValue || 0).getTime() - new Date(bValue || 0).getTime();
            break;
          case "boolean":
            comparison = (aValue ? 1 : 0) - (bValue ? 1 : 0);
            break;
          default:
            comparison = String(aValue || "").localeCompare(
              String(bValue || ""),
            );
        }

        return sortDirection === "asc" ? comparison : -comparison;
      });
    }

    return filtered;
  }, [data, searchTerm, sortColumn, sortDirection]);

  // Pagination
  const totalPages =
    pageSize > 0 ? Math.ceil(processedData.length / pageSize) : 1;
  const paginatedData =
    pageSize > 0
      ? processedData.slice(
          (currentPage - 1) * pageSize,
          currentPage * pageSize,
        )
      : processedData;

  // Handle sorting (all columns are sortable by default)
  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      setSortDirection(
        sortDirection === "asc"
          ? "desc"
          : sortDirection === "desc"
            ? null
            : "asc",
      );
      if (sortDirection === "desc") {
        setSortColumn(null);
      }
    } else {
      setSortColumn(columnKey);
      setSortDirection("asc");
    }
  };

  // Export to CSV
  const exportToCSV = () => {
    const visibleCols = columns.filter((col) => visibleColumns.has(col.key));
    const csvContent = [
      // Header
      visibleCols
        .map((col) => col.label)
        .join(","),
      // Data rows
      ...processedData.map((row) =>
        visibleCols
          .map((col) => `"${formatCellValue(row[col.key], col.type)}"`)
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/\s+/g, "_")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Export to Excel (lazy load XLSX library)
  const exportToExcel = async () => {
    try {
      // Dynamically load XLSX from CDN
      const XLSX = await loadXLSX();

      const visibleCols = columns.filter((col) => visibleColumns.has(col.key));

      // Prepare data for Excel
      const excelData = [
        // Header row
        visibleCols.map((col) => col.label),
        // Data rows
        ...processedData.map((row) =>
          visibleCols.map((col) => {
            const value = row[col.key];
            // Convert formatted values back to raw values for Excel
            switch (col.type) {
              case "number":
                return typeof value === "number"
                  ? value
                  : Number(value) || value;
              case "date":
                return value instanceof Date ? value : new Date(value);
              case "boolean":
                return typeof value === "boolean" ? value : value;
              default:
                return value;
            }
          }),
        ),
      ];

      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(excelData);

      // Auto-size columns
      const colWidths = visibleCols.map((col) => {
        const maxLength = Math.max(
          col.label.length,
          ...processedData.map(
            (row) =>
              String(formatCellValue(row[col.key], col.type) || "").length,
          ),
        );
        return { wch: Math.min(Math.max(maxLength + 2, 10), 50) };
      });
      worksheet["!cols"] = colWidths;

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, "Data");

      // Save file
      XLSX.writeFile(workbook, `${title.replace(/\s+/g, "_")}.xlsx`);
    } catch (error) {
      console.error("Failed to export Excel:", error);
      // Fallback to CSV if Excel export fails
      exportToCSV();
    }
  };

  const visibleColumnsArray = columns.filter((col) =>
    visibleColumns.has(col.key),
  );

  return (
    <div className="px-6">
      <Card className="w-full px-0">
        <CardHeader>
          <div className="flex flex-col">
            <CardTitle className="w-full flex items-center gap-2 justify-between">
              Interactive Table - {title}
              <JsonViewPopup data={props} />
            </CardTitle>
            {description && (
              <CardDescription className="mt-2 ">{description}</CardDescription>
            )}
          </div>

          {/* Search and Export */}
          <div className="flex items-center gap-2 mt-4">
            {searchable && (
              <div className="flex-1">
                <Input
                  placeholder="Search across all columns..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="hover:bg-input bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
                />
              </div>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="data-[state=open]:bg-accent">
                  <Eye className="size-3.5" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {columns.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.key}
                    checked={visibleColumns.has(column.key)}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const newVisible = new Set(visibleColumns);
                      const checked = !newVisible.has(column.key);
                      if (checked) {
                        newVisible.add(column.key);
                      } else {
                        newVisible.delete(column.key);
                      }
                      setVisibleColumns(newVisible);
                    }}
                  >
                    {column.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {exportable && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="data-[state=open]:bg-accent"
                  >
                    <Download className="size-3.5" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={exportToCSV}>
                    <Download className="h-4 w-4 mr-2" />
                    CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={exportToExcel}>
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Excel
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </CardHeader>

        <CardContent className="px-0 relative">
          <Table>
            <TableHeader className="bg-secondary border-t">
              <TableRow>
                {visibleColumnsArray.map((column, index) => {
                  return (
                    <TableHead
                      key={column.key}
                      className={`relative select-none ${index === 0 ? "pl-6" : index === visibleColumnsArray.length - 1 ? "pr-6" : ""} ${
                        column.type === "number" ||
                        column.type === "date" ||
                        column.type === "boolean"
                          ? "text-center"
                          : ""
                      }`}
                    >
                      {/* Column header with sorting */}
                      <div
                        className={`flex items-center gap-2 cursor-pointer ${
                          column.type === "number" || column.type === "date"
                            ? "justify-center"
                            : ""
                        }`}
                        onClick={() => handleSort(column.key)}
                      >
                        <span className="hover:text-primary">
                          {column.label}
                        </span>

                        <ArrowDownUp
                          className={`h-3 w-3 ${
                            sortColumn === column.key
                              ? ""
                              : "text-muted-foreground/30"
                          }`}
                        />
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>

            <TableBody className="min-h-[24rem]">
              {paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={visibleColumnsArray.length}
                    className="text-center h-48"
                  >
                    No data found
                  </TableCell>
                </TableRow>
              ) : (
                paginatedData.map((row, index) => {
                  return (
                    <TableRow key={index} className={`border-b!`}>
                      {visibleColumnsArray.map((column, index) => (
                        <TableCell
                          key={column.key}
                          className={`py-3 ${index === 0 ? "pl-6" : index === visibleColumnsArray.length - 1 ? "pr-6" : ""} ${
                            column.type === "number" || column.type === "date"
                              ? "text-center"
                              : column.type == "boolean"
                                ? "flex items-center justify-center"
                                : ""
                          }`}
                        >
                          {column.type == "boolean" ? (
                            <>
                              <Checkbox checked={row[column.key]} />
                            </>
                          ) : searchTerm && searchable ? (
                            highlightText(
                              formatCellValue(row[column.key], column.type),
                              searchTerm,
                            )
                          ) : (
                            formatCellValue(row[column.key], column.type)
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="flex items-center justify-between pt-4 px-6">
            <div className="text-xs text-muted-foreground">
              Total rows: {data.length}
            </div>
            {pageSize > 0 && totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((prev) => Math.max(1, prev - 1))
                  }
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>

                <span className="text-sm px-2">
                  Page {currentPage} of {totalPages}
                </span>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                  }
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

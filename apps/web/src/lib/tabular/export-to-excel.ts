import ExcelJS from "exceljs";

export interface TabularExportRow {
  documentTitle: string;
  cells: Record<string, string | null>;
}

export interface TabularExportOptions {
  title: string;
  columns: { id: string; label: string }[];
  rows: TabularExportRow[];
}

export async function exportToExcel(
  opts: TabularExportOptions,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "keinsaas-navigator";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(opts.title.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const headerRow = ["Document", ...opts.columns.map((c) => c.label)];
  sheet.addRow(headerRow);

  const headerFill: ExcelJS.FillPattern = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" },
  };
  const headerFont: Partial<ExcelJS.Font> = {
    bold: true,
    color: { argb: "FFFFFFFF" },
  };

  sheet.getRow(1).eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { vertical: "middle", wrapText: true };
  });

  sheet.getColumn(1).width = 35;
  for (let i = 2; i <= headerRow.length; i++) {
    sheet.getColumn(i).width = 40;
  }

  for (const row of opts.rows) {
    const values = [
      row.documentTitle,
      ...opts.columns.map((c) => row.cells[c.id] ?? ""),
    ];
    const exRow = sheet.addRow(values);
    exRow.eachCell((cell) => {
      cell.alignment = { wrapText: true, vertical: "top" };
    });
  }

  sheet.getRow(1).height = 24;

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

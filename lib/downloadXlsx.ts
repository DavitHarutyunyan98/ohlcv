/**
 * Client-side XLSX download using SheetJS.
 * Dynamically imported so it doesn't bloat the server bundle.
 */
export async function downloadXlsx(
  rows: Record<string, unknown>[],
  filename: string,
  sheetName = "Data"
): Promise<void> {
  const XLSX = await import("xlsx");

  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-size columns
  const colWidths = Object.keys(rows[0] ?? {}).map((key) => ({
    wch: Math.max(
      key.length,
      ...rows.slice(0, 200).map((r) => String(r[key] ?? "").length)
    ),
  }));
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

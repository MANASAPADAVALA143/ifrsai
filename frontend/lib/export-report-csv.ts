/**
 * Export report data as CSV (Excel-compatible).
 * For full .xlsx with sheets use SheetJS (xlsx) when added.
 */

export function exportReportCsv(
  reportName: string,
  headers: string[],
  rows: (string | number)[][],
  filename?: string
): void {
  const escape = (v: string | number) => {
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const title = `IFRSAI — ${reportName}`;
  const generated = `Generated: ${new Date().toLocaleString()}`;
  const csv = [
    title,
    generated,
    '',
    headers.map(escape).join(','),
    ...rows.map((r) => r.map(escape).join(',')),
  ].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || `${reportName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

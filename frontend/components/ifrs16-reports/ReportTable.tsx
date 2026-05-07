'use client';

import Link from 'next/link';

const PAGE_SIZE = 25;

interface ReportTableProps {
  columns: { key: string; label: string; align?: 'left' | 'right'; className?: string }[];
  rows: Record<string, React.ReactNode>[];
  page?: number;
  onPageChange?: (page: number) => void;
  totalRows?: number;
  emptyMessage?: string;
  freezeColumns?: number;
  rowClassName?: (row: Record<string, React.ReactNode>, index: number) => string;
  leaseIdKey?: string;
  linkColumnKey?: string;
  linkHrefKey?: string;
}

export function ReportTable({
  columns,
  rows,
  page = 1,
  onPageChange,
  totalRows,
  emptyMessage = 'No Data Found',
  freezeColumns = 0,
  rowClassName,
  linkColumnKey,
  linkHrefKey = 'id',
}: ReportTableProps) {
  const total = totalRows ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const paginatedRows = onPageChange ? rows.slice(start, start + PAGE_SIZE) : rows;

  return (
    <div className="bg-white border border-[#e2e8f0] rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#374151] text-white">
              {columns.map((col, i) => (
                <th
                  key={col.key}
                  className={`px-3 py-2.5 font-semibold text-left ${col.align === 'right' ? 'text-right' : ''} ${freezeColumns > 0 && i < freezeColumns ? 'sticky left-0 z-10 bg-[#374151]' : ''} ${col.className ?? ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-[#64748b]">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, idx) => (
                <tr
                  key={idx}
                  className={`border-t border-[#e2e8f0] ${idx % 2 === 1 ? 'bg-[#f9fafb]' : 'bg-white'} ${rowClassName?.(row, start + idx) ?? ''}`}
                >
                  {columns.map((col, i) => {
                    const cell = row[col.key];
                    const isLink = linkColumnKey === col.key && row[linkHrefKey] != null;
                    const href = isLink ? `/dashboard/ifrs16/leases/${row[linkHrefKey]}` : null;
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-2 ${col.align === 'right' ? 'text-right font-mono' : ''} ${freezeColumns > 0 && i < freezeColumns ? 'sticky left-0 z-10 bg-inherit' : ''}`}
                      >
                        {isLink && href ? (
                          <Link href={href} className="text-[#f97316] hover:underline">
                            {cell}
                          </Link>
                        ) : (
                          cell
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {onPageChange && total > PAGE_SIZE && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-[#e2e8f0] bg-[#f9fafb]">
          <span className="text-xs text-[#64748b]">
            Showing {start + 1}-{Math.min(start + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(currentPage - 1)}
              className="px-2 py-1 rounded border border-[#e2e8f0] disabled:opacity-50 text-sm"
            >
              ←
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let p = currentPage - 2 + i;
              if (p < 1) p = 1;
              if (p > totalPages) p = totalPages;
              return p;
            })
              .filter((v, i, a) => a.indexOf(v) === i)
              .map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPageChange(p)}
                  className={`w-8 h-8 rounded text-sm ${p === currentPage ? 'bg-[#f97316] text-white' : 'border border-[#e2e8f0]'}`}
                >
                  {p}
                </button>
              ))}
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange(currentPage + 1)}
              className="px-2 py-1 rounded border border-[#e2e8f0] disabled:opacity-50 text-sm"
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { PAGE_SIZE };

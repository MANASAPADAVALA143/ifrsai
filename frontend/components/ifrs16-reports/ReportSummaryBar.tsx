'use client';

interface ReportSummaryBarProps {
  contractCount: number;
  totalLabel?: string;
  totalAmount?: string;
  statusCounts?: { label: string; count: number }[];
  typeCounts?: { label: string; count: number }[];
}

export function ReportSummaryBar({
  contractCount,
  totalLabel,
  totalAmount,
  statusCounts = [],
  typeCounts = [],
}: ReportSummaryBarProps) {
  return (
    <div className="bg-white border border-[#e2e8f0] rounded-xl p-4 mb-4 flex flex-wrap items-center gap-4">
      <span className="text-sm font-medium text-[#1e293b]">Contracts: <strong>{contractCount}</strong></span>
      {totalLabel != null && totalAmount != null && (
        <span className="text-sm text-[#64748b]">| {totalLabel}: <strong className="text-[#f97316] font-mono">{totalAmount}</strong></span>
      )}
      {statusCounts.length > 0 && (
        <span className="text-sm text-[#64748b]">
          | {statusCounts.map((s) => `${s.label}: ${s.count}`).join(' | ')}
        </span>
      )}
      {typeCounts.length > 0 && (
        <span className="text-sm text-[#64748b]">
          Types: {typeCounts.map((t) => `${t.label}: ${t.count}`).join(' | ')}
        </span>
      )}
    </div>
  );
}

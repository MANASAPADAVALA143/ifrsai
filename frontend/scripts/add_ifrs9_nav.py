"""Wrap IFRS 9 overview page with ModuleWorkspaceLayout and section nav."""
from pathlib import Path

PAGE = Path(__file__).resolve().parents[1] / "app/dashboard/ifrs9/page.tsx"
text = PAGE.read_text(encoding="utf-8")

IMPORTS = """import { ModuleWorkspaceLayout } from '@/components/module/ModuleWorkspaceLayout';
import { IFRS9_NAV_GROUPS, ifrs9NavHref, type Ifrs9NavId } from '@/lib/ifrs9-nav';
import { useRouter } from 'next/navigation';
"""

if "ModuleWorkspaceLayout" not in text:
    text = text.replace(
        "import toast from 'react-hot-toast';\n",
        "import toast from 'react-hot-toast';\n" + IMPORTS,
        1,
    )

STATE = """  const [activeNavId, setActiveNavId] = useState<Ifrs9NavId>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const router = useRouter();
"""

if "activeNavId" not in text:
    text = text.replace(
        "  const [portfolios, setPortfolios] = useState<ECLPortfolioEntry[]>([]);\n",
        "  const [portfolios, setPortfolios] = useState<ECLPortfolioEntry[]>([]);\n" + STATE,
        1,
    )

HANDLER = """
  const handleIfrs9NavSelect = (navId: string) => {
    const id = navId as Ifrs9NavId;
    const href = ifrs9NavHref(id);
    if (href) {
      router.push(href);
      return;
    }
    setActiveNavId(id);
    if (id === 'classification') setClassificationPanelOpen(true);
    if (id === 'macro-overlay') setMacroPanelOpen(true);
    if (id === 'provision-matrix') setProvisionPanelOpen(true);
    if (id === 'reports' && hasCalcData) void handleGenerateMasterReport();
  };

  const ifrs9KpiItems = [
    {
      label: 'Total Portfolio Value (EAD)',
      value: hasCalcData ? fmtKpi(results!.total_ead) : '—',
      accent: 'orange' as const,
    },
    {
      label: 'Total ECL Provision',
      value: showTotalEclKpi ? fmtKpi(totalEclKpiValue) : '—',
      accent: 'orange' as const,
    },
    {
      label: 'Weighted Average PD',
      value: hasCalcData && results!.weighted_avg_pd != null ? fmtPct(results!.weighted_avg_pd) : '—',
      accent: 'orange' as const,
    },
    {
      label: 'Coverage Ratio',
      value: hasCalcData && results!.coverage_ratio != null ? fmtPct(results!.coverage_ratio) : '—',
      accent: 'pink' as const,
    },
  ];
"""

if "handleIfrs9NavSelect" not in text:
    text = text.replace(
        "  const showTotalEclKpi = totalEclKpiValue != null && (macroOverlayResult != null || hasCalcData);\n",
        "  const showTotalEclKpi = totalEclKpiValue != null && (macroOverlayResult != null || hasCalcData);\n" + HANDLER,
        1,
    )

# Wrap main content
old_open = """    >
      <div className="space-y-6">
        <div className="flex flex-wrap gap-3">"""

new_open = """    >
      <ModuleWorkspaceLayout
        navGroups={IFRS9_NAV_GROUPS}
        activeNavId={activeNavId}
        onNavSelect={handleIfrs9NavSelect}
        mobileNavOpen={mobileNavOpen}
        onMobileNavOpenChange={setMobileNavOpen}
        kpiItems={ifrs9KpiItems}
        navTitle="IFRS 9 Menu"
      >
      <div className="space-y-6">
        {(activeNavId === 'overview') && (
        <div className="flex flex-wrap gap-3">"""

if old_open not in text:
    raise SystemExit("ifrs9 open block not found")
text = text.replace(old_open, new_open, 1)

text = text.replace(
    """          </Link>
        </div>

        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#f8fafc]"
            onClick={() => setClassificationPanelOpen((o) => !o)}
          >
            <div>
              <h2 className="text-base font-bold text-[#1e293b]">Classification &amp; Measurement</h2>""",
    """          </Link>
        </div>
        )}

        {(activeNavId === 'classification') && (
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#e2e8f0]">
            <div>
              <h2 className="text-base font-bold text-[#1e293b]">Classification &amp; Measurement</h2>""",
    1,
)

text = text.replace(
    """            {classificationPanelOpen ? <ChevronUp className="w-5 h-5 text-[#64748b]" /> : <ChevronDown className="w-5 h-5 text-[#64748b]" />}
          </button>
          <div className="px-5 pb-3 border-t border-[#e2e8f0]">""",
    """            </div>
          </div>
          <div className="px-5 pb-3 border-t border-[#e2e8f0]">""",
    1,
)

text = text.replace(
    """          {classificationPanelOpen && (
            <div className="px-5 pb-5 pt-0 space-y-6 border-t border-[#f1f5f9]">""",
    """          <div className="px-5 pb-5 pt-0 space-y-6 border-t border-[#f1f5f9]">""",
    1,
)

text = text.replace(
    """            </div>
          )}
        </div>

        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#f8fafc]"
            onClick={() => setMacroPanelOpen((o) => !o)}
          >
            <div>
              <h2 className="text-base font-bold text-[#1e293b]">Forward-Looking Macro Overlay</h2>""",
    """            </div>
        </div>
        )}

        {(activeNavId === 'macro-overlay') && (
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#e2e8f0]">
            <div>
              <h2 className="text-base font-bold text-[#1e293b]">Forward-Looking Macro Overlay</h2>""",
    1,
)

text = text.replace(
    """            {macroPanelOpen ? <ChevronUp className="w-5 h-5 text-[#64748b]" /> : <ChevronDown className="w-5 h-5 text-[#64748b]" />}
          </button>
          <div className="px-5 pb-3 border-t border-[#e2e8f0]">
            <div className="mt-3 rounded-[12px] border border-[#bfdbfe] bg-[#eff6ff] p-4 text-sm text-[#1e3a5f]">
              IFRS 9.5.5.17 requires forward-looking macroeconomic information""",
    """            </div>
          </div>
          <div className="px-5 pb-3 border-t border-[#e2e8f0]">
            <div className="mt-3 rounded-[12px] border border-[#bfdbfe] bg-[#eff6ff] p-4 text-sm text-[#1e3a5f]">
              IFRS 9.5.5.17 requires forward-looking macroeconomic information""",
    1,
)

text = text.replace(
    """          {macroPanelOpen && (
            <div className="px-5 pb-5 space-y-6 border-t border-[#f1f5f9]">""",
    """          <div className="px-5 pb-5 space-y-6 border-t border-[#f1f5f9]">""",
    1,
)

# macro panel close before provision
text = text.replace(
    """            </div>
          )}
        </div>

        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#f8fafc]"
            onClick={() => setProvisionPanelOpen((o) => !o)}
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-[#1e293b]">Provision Matrix</h2>""",
    """            </div>
        </div>
        )}

        {(activeNavId === 'provision-matrix') && (
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#e2e8f0]">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-[#1e293b]">Provision Matrix</h2>""",
    1,
)

text = text.replace(
    """            {provisionPanelOpen ? <ChevronUp className="w-5 h-5 text-[#64748b]" /> : <ChevronDown className="w-5 h-5 text-[#64748b]" />}
          </button>
          <div className="px-5 pb-3 border-t border-[#e2e8f0]">
            <div className="mt-3 rounded-[12px] border border-[#bfdbfe] bg-[#eff6ff] p-4 text-sm text-[#1e3a5f]">
              Groups receivables by ageing bucket""",
    """            </div>
          </div>
          <div className="px-5 pb-3 border-t border-[#e2e8f0]">
            <div className="mt-3 rounded-[12px] border border-[#bfdbfe] bg-[#eff6ff] p-4 text-sm text-[#1e3a5f]">
              Groups receivables by ageing bucket""",
    1,
)

text = text.replace(
    """          {provisionPanelOpen && (
            <div className="px-5 pb-5 space-y-6 border-t border-[#f1f5f9]">""",
    """          <div className="px-5 pb-5 space-y-6 border-t border-[#f1f5f9]">""",
    1,
)

# After provision panel ends - wrap classification warnings and KPI
text = text.replace(
    """        {classificationResult && !classificationResult.ecl_applies && (
          <div className="rounded-[14px] border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">""",
    """        )}

        {(activeNavId === 'calculate') && classificationResult && !classificationResult.ecl_applies && (
          <div className="rounded-[14px] border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">""",
    1,
)

text = text.replace(
    """        {classificationResult && classificationResult.ecl_applies && (
          <div className="rounded-[14px] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">""",
    """        {(activeNavId === 'calculate') && classificationResult && classificationResult.ecl_applies && (
          <div className="rounded-[14px] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">""",
    1,
)

# Remove duplicate KPI row - comment it out by wrapping in false
text = text.replace(
    """        {/* 4 KPI cards — values only after calculate (aggregated applicableEcl) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">""",
    """        {/* KPI cards moved to ModuleKpiBar */}
        {false && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">""",
    1,
)

text = text.replace(
    """          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          {/* LEFT */}
          <div className="space-y-6">
            <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <h3 className="text-base font-bold text-[#1e293b] mb-4 border-b border-[#e2e8f0] pb-2">Calculation results</h3>""",
    """          </div>
        </div>
        )}

        {(activeNavId === 'calculate') && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          {/* LEFT */}
          <div className="space-y-6">
            <div className="bg-white rounded-[14px] p-6 border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
              <h3 className="text-base font-bold text-[#1e293b] mb-4 border-b border-[#e2e8f0] pb-2">Calculation results</h3>""",
    1,
)

# Portfolio table - overview only
text = text.replace(
    """        {/* Recent portfolios quick links */}
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">""",
    """        )}

        {(activeNavId === 'reconciliation') && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6">
          <h3 className="text-base font-bold text-[#1e293b] mb-2">ECL Reconciliation</h3>
          <p className="text-sm text-[#64748b] mb-4">Roll-forward from opening to closing ECL provision — compare calculated ECL to GL balances.</p>
          {hasCalcData ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b"><span>Opening ECL provision</span><span className="font-mono">—</span></div>
              <div className="flex justify-between py-2 border-b"><span>Current period charge</span><span className="font-mono text-red-600">{fmtKpi(results!.total_ecl)}</span></div>
              <div className="flex justify-between py-2 border-b"><span>Write-offs / recoveries</span><span className="font-mono">—</span></div>
              <div className="flex justify-between py-2 font-semibold"><span>Closing ECL provision</span><span className="font-mono">{fmtKpi(results!.total_ecl)}</span></div>
            </div>
          ) : (
            <p className="text-sm text-[#64748b]">Calculate ECL on at least one portfolio to run reconciliation.</p>
          )}
        </div>
        )}

        {(activeNavId === 'reports') && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 space-y-4">
          <h3 className="text-base font-bold text-[#1e293b]">Export &amp; Reports</h3>
          <p className="text-sm text-[#64748b]">Generate the IFRS 9 master compliance report with staging, ECL, and disclosure narrative.</p>
          <Button
            type="button"
            variant="primary"
            className="bg-gradient-to-r from-orange-500 to-orange-600 text-white"
            disabled={!hasCalcData || masterLoading}
            onClick={() => void handleGenerateMasterReport()}
            isLoading={masterLoading}
          >
            <FileBarChart className="w-4 h-4 mr-2" /> Generate IFRS 9 Master Report
          </Button>
        </div>
        )}

        {(activeNavId === 'overview') && (
        <div className="bg-white rounded-[14px] border border-[#e2e8f0] shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden">""",
    1,
)

# Close layout before floating button
text = text.replace(
    """      </div>

      {hasCalcData ? (
        <button
          type="button"
          onClick={() => void handleGenerateMasterReport()}""",
    """      </div>
      </ModuleWorkspaceLayout>

      {hasCalcData ? (
        <button
          type="button"
          onClick={() => void handleGenerateMasterReport()}""",
    1,
)

PAGE.write_text(text, encoding="utf-8")
print("IFRS 9 nav layout applied")

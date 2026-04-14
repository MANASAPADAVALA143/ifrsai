'use client';

import { useState } from 'react';
import { SidebarLayout } from '@/components/SidebarLayout';
import { Button } from '@/components/Button';
import { Upload, FileText, Calculator, Download, Loader2, CheckCircle2, Clock, ArrowRight, Copy } from 'lucide-react';
import { ifrs15Api } from '@/lib/api';
import toast from 'react-hot-toast';
import { formatCurrency, sanitizeCurrencyCode } from '@/lib/utils';

// Map extraction to calculate request
function mapExtractionToContract(extracted: any): any {
  const step1 = extracted?.step1_identify_contract?.contract_details || {};
  const rawObligations = extracted?.step2_performance_obligations?.identified_obligations;
  const obligations = Array.isArray(rawObligations) ? rawObligations : [];
  const step3 = extracted?.step3_transaction_price || {};
  const rawStep5 = extracted?.step5_recognition?.obligations_recognition_timing;
  const step5 = Array.isArray(rawStep5) ? rawStep5 : [];

  const recognitionMap: Record<string, any> = {};
  step5.forEach((r: any) => { recognitionMap[r.obligation_id] = r; });

  const perfObs = obligations.map((ob: any) => {
    const rec = recognitionMap[ob.obligation_id] || {};
    return {
      obligation_id: ob.obligation_id || `PO-${obligations.indexOf(ob) + 1}`,
      description: ob.description || 'Unnamed obligation',
      standalone_selling_price: ob.standalone_selling_price_estimate ?? 0,
      recognition_method: rec.recognition_pattern === 'point_in_time' ? 'point_in_time' : 'over_time',
      duration_months: rec.duration_months ?? 12,
      transfer_date: rec.transfer_date || null,
    };
  });

  const varCons = step3.variable_consideration || {};
  const fixed = step3.fixed_consideration ?? step3.total_transaction_price ?? step1.total_contract_value ?? 0;
  const variable = (varCons.performance_bonuses ?? 0) + (varCons.volume_discounts ?? 0) - (varCons.discounts ?? 0) - (varCons.rebates ?? 0) - (varCons.penalties ?? 0);
  const totalPrice = step3.total_transaction_price ?? step1.total_contract_value ?? fixed;

  return {
    contract_id: step1.contract_id || `CONTRACT-${Date.now()}`,
    customer_name: step1.customer_name || '',
    vendor_name: step1.vendor_name || '',
    effective_date: step1.effective_date || new Date().toISOString().split('T')[0],
    contract_term_months: step1.contract_term_months ?? 12,
    fixed_consideration: typeof fixed === 'number' ? fixed : parseFloat(String(fixed)) || 0,
    variable_consideration: typeof variable === 'number' ? variable : parseFloat(String(variable)) || 0,
    variable_consideration_constrained: varCons.variable_consideration_constrained ?? 0,
    constraint_percentage: varCons.constraint_percentage ?? 100,
    constraint_method: varCons.constraint_method ?? 'percentage',
    discounts: varCons.discounts ?? 0,
    rebates: varCons.rebates ?? 0,
    financing_adjustment: step3.significant_financing_component?.adjustment_amount ?? 0,
    currency: sanitizeCurrencyCode(step1.currency, 'USD'),
    contract_type: 'fixed_price',
    hourly_rate: 0,
    hours_worked: 0,
    tm_cap: 0,
    cumulative_billed: 0,
    total_estimated_cost: 0,
    actual_cost_to_date: 0,
    prior_revenue_recognised: 0,
    maintenance_term_months: 0,
    volume_slabs: [],
    estimated_annual_volume: 0,
    can_estimate_volume: true,
    sla_items: [],
    cash_received: 0,
    performance_obligations: perfObs.length ? perfObs : [{
      obligation_id: 'PO-1',
      description: 'Revenue',
      standalone_selling_price: totalPrice,
      recognition_method: 'over_time',
      duration_months: step1.contract_term_months ?? 12,
      transfer_date: null,
    }],
  };
}

export default function IFRS15Page() {
  const [activeTab, setActiveTab] = useState<'upload' | 'manual'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [results, setResults] = useState<any>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [contractText, setContractText] = useState('');
  const [vcConstraint, setVcConstraint] = useState({
    constraint_method: 'percentage',
    constraint_percentage: 100,
    variable_consideration_constrained: 0,
  });
  const [lastContractInfo, setLastContractInfo] = useState<{ contract_id?: string; customer_name?: string; effective_date?: string; contract_term_months?: number; currency?: string }>({});
  const [scheduleViewAll, setScheduleViewAll] = useState(false);
  const [showSLA, setShowSLA] = useState(false);
  const [showVolumeDiscount, setShowVolumeDiscount] = useState(false);
  const [slaItems, setSlaItems] = useState<any[]>([]);
  const [volumeSlabs, setVolumeSlabs] = useState<any[]>([]);
  const [step3, setStep3] = useState<any>({
    contract_type: 'fixed_price',
    hourly_rate: '',
    hours_worked: '',
    tm_cap: '',
    cumulative_billed: '',
    total_estimated_cost: '',
    actual_cost_to_date: '',
    prior_revenue_recognised: '',
    maintenance_term_months: '',
    estimated_annual_volume: '',
    can_estimate_volume: true,
  });
  const updateStep3 = (patch: Record<string, any>) => {
    setStep3((prev: any) => ({ ...prev, ...patch }));
  };
  const addSLAItem = () => {
    setSlaItems((prev) => [...prev, { name: '', target: '', actual: '', monthly_fee: '', penalty_multiplier: 1 }]);
  };
  const addVolumeSlab = () => {
    setVolumeSlabs((prev) => [...prev, { min_volume: '', max_volume: '', discount_pct: '' }]);
  };

  const step1 = extractedData?.step1_identify_contract?.contract_details || {};
  const extractedVarCons = extractedData?.step3_transaction_price?.variable_consideration || {};
  const extractedVariableAmount =
    (Number(extractedVarCons.performance_bonuses ?? 0) + Number(extractedVarCons.volume_discounts ?? 0))
    - Number(extractedVarCons.discounts ?? 0)
    - Number(extractedVarCons.rebates ?? 0)
    - Number(extractedVarCons.penalties ?? 0);
  const stepStatus = {
    step1: !!extractedData?.step1_identify_contract,
    step2: !!(extractedData?.step2_performance_obligations?.identified_obligations?.length),
    step3: !!extractedData?.step3_transaction_price?.total_transaction_price,
    step4: !!(extractedData?.step4_allocation_hints || extractedData?.step2_performance_obligations?.identified_obligations?.length),
    step5: !!results,
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) {
      setFile(null);
      return;
    }
    if (!selectedFile.name.match(/\.(pdf|docx|txt|xlsx|xls)$/i)) {
      toast.error('Please upload a PDF, DOCX, TXT, or Excel file (.xlsx, .xls)');
      setFile(null);
      return;
    }
    setFile(selectedFile);
    setIsUploading(true);
    setExtractedData(null);
    try {
      const response = await ifrs15Api.uploadContract(selectedFile) as any;
      const { data, error } = response;
      if (error) throw new Error(error);
      setExtractedData(data?.extracted_data);
      const vc = data?.extracted_data?.step3_transaction_price?.variable_consideration || {};
      setVcConstraint({
        constraint_method: vc.constraint_method ?? 'percentage',
        constraint_percentage: Number(vc.constraint_percentage ?? 100),
        variable_consideration_constrained: Number(vc.variable_consideration_constrained ?? 0),
      });
      toast.success('Contract extracted successfully!');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to extract contract');
      setFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCalculate = async (contractData?: any) => {
    const basePayload = contractData || (extractedData ? mapExtractionToContract(extractedData) : null);
    const payload = basePayload
      ? {
          ...basePayload,
          constraint_method: vcConstraint.constraint_method,
          constraint_percentage: vcConstraint.constraint_percentage,
          variable_consideration_constrained: vcConstraint.variable_consideration_constrained,
          contract_type: step3.contract_type || 'fixed_price',
          hourly_rate: Number(step3.hourly_rate || 0),
          hours_worked: Number(step3.hours_worked || 0),
          tm_cap: Number(step3.tm_cap || 0),
          cumulative_billed: Number(step3.cumulative_billed || 0),
          total_estimated_cost: Number(step3.total_estimated_cost || 0),
          actual_cost_to_date: Number(step3.actual_cost_to_date || 0),
          prior_revenue_recognised: Number(step3.prior_revenue_recognised || 0),
          maintenance_term_months: Number(step3.maintenance_term_months || 0),
          volume_slabs: volumeSlabs.map((s) => ({
            min_volume: Number(s.min_volume || 0),
            max_volume: Number(s.max_volume || 0),
            discount_pct: Number(s.discount_pct || 0),
          })),
          estimated_annual_volume: Number(step3.estimated_annual_volume || 0),
          can_estimate_volume: Boolean(step3.can_estimate_volume),
          sla_items: slaItems.map((s) => ({
            name: s.name || '',
            target: Number(s.target || 0),
            actual: Number(s.actual || 0),
            monthly_fee: Number(s.monthly_fee || 0),
            penalty_multiplier: Number(s.penalty_multiplier || 1),
          })),
        }
      : null;
    if (!payload || !payload.performance_obligations?.length) {
      toast.error('No contract data. Upload a contract or enter manually.');
      return;
    }
    setIsCalculating(true);
    try {
      const response = await ifrs15Api.calculate(payload) as any;
      const { data, error } = response;
      if (error) throw new Error(error);
      setResults(data?.results);
      setFileId(data?.excel_file_id || null);
      setLastContractInfo({
        contract_id: payload.contract_id,
        customer_name: payload.customer_name,
        effective_date: payload.effective_date,
        contract_term_months: payload.contract_term_months,
        currency: sanitizeCurrencyCode(payload.currency, 'USD'),
      });
      toast.success('Calculation completed!');
    } catch (error: any) {
      toast.error(error?.message || 'Calculation failed');
    } finally {
      setIsCalculating(false);
    }
  };

  const moduleCards = [
    { id: 'contract-identification', name: 'Contract Identification', gradient: 'gradient-orange' },
    { id: 'performance-obligations', name: 'Performance Obligations', gradient: 'gradient-pink' },
    { id: 'transaction-price', name: 'Transaction Price', gradient: 'gradient-amber' },
    { id: 'price-allocation', name: 'Price Allocation', gradient: 'gradient-orange' },
    { id: 'revenue-recognition', name: 'Revenue Recognition', gradient: 'gradient-pink' },
    { id: 'contract-modifications', name: 'Contract Modifications', gradient: 'gradient-amber' },
    { id: 'disclosures', name: 'Disclosures', gradient: 'gradient-orange' },
  ];

  const disclosureData = results?.disclosure_data || {};
  const contractDetails = disclosureData?.contract_details || {};
  const currency = sanitizeCurrencyCode(
    contractDetails.currency || lastContractInfo.currency || step1.currency,
    'USD'
  );
  const balances = results?.contract_balances || {};
  const schedule = Array.isArray(results?.recognition_schedule) ? results.recognition_schedule : [];
  const rawAllocations = results?.allocations;
  const allocations =
    rawAllocations && typeof rawAllocations === 'object' && !Array.isArray(rawAllocations)
      ? rawAllocations
      : {};
  const journalEntries = results?.journal_entries || {};

  const contractId = contractDetails.contract_id || lastContractInfo.contract_id || step1.contract_id || '—';
  const customerName = contractDetails.customer || lastContractInfo.customer_name || step1.customer_name || '—';
  const contractDate = contractDetails.effective_date || lastContractInfo.effective_date || step1.effective_date || '—';
  const contractTerm = contractDetails.term_months ?? lastContractInfo.contract_term_months ?? step1.contract_term_months ?? '—';
  const rawPerfObs = disclosureData?.performance_obligations;
  const perfObs = Array.isArray(rawPerfObs) ? rawPerfObs : [];
  const tp = results?.transaction_price || 0;
  const rec = balances.revenue_recognized_to_date || 0;
  const def = balances.contract_liability_amount || 0;
  const effectiveRevenueRate = tp > 0 ? ((rec / tp) * 100).toFixed(1) : '0';
  const numPOBs = Object.keys(allocations).length || perfObs.length;

  const generateDisclosureText = () => {
    if (!results) return '';
    const c = sanitizeCurrencyCode(disclosureData.contract_details?.currency || currency, 'USD');
    const sym = c === 'INR' ? '₹' : c === 'USD' ? '$' : c === 'GBP' ? '£' : c === 'EUR' ? '€' : c;
    const pointInTime = perfObs.filter((p: any) => p.recognition_method === 'point_in_time').reduce((s: number, p: any) => s + (p.revenue_recognized || 0), 0);
    const overTime = perfObs.filter((p: any) => p.recognition_method === 'over_time').reduce((s: number, p: any) => s + (p.revenue_recognized || 0), 0);
    return `IFRS 15 DISCLOSURE NOTES
=========================
Note: Revenue from Contracts with Customers

The Company recognises revenue in accordance with IFRS 15. Revenue is measured at the transaction price agreed under the contract.

Contract Balances:
- Contract Assets: ${sym} ${(balances.contract_asset_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
- Contract Liabilities (Deferred Revenue): ${sym} ${(balances.contract_liability_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
- Revenue Recognised to Date: ${sym} ${(balances.revenue_recognized_to_date || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
- Cash Received to Date: ${sym} ${(balances.cash_received_to_date || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}

Performance Obligations:
${perfObs.length ? perfObs.map((p: any) => `- ${p.obligation || p.obligation_id}: ${sym} ${(p.allocated_amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${(p.recognition_method || '').replace('_', ' ')})`).join('\n') : Object.entries(allocations).map(([id, amt]) => `- ${id}: ${sym} ${Number(amt).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`).join('\n')}

Disaggregation of Revenue:
- Point in Time: ${sym} ${pointInTime.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
- Over Time: ${sym} ${overTime.toLocaleString('en-IN', { maximumFractionDigits: 0 })}

Transaction Price allocated to remaining performance obligations:
Remaining unrecognised: ${sym} ${((tp || 0) - rec).toLocaleString('en-IN', { maximumFractionDigits: 0 })}

Report generated: ${results.calculation_metadata?.calculation_date || new Date().toLocaleString()}`;
  };

  const handleCopyDisclosure = () => {
    navigator.clipboard.writeText(generateDisclosureText()).then(() => toast.success('Disclosure copied!')).catch(() => toast.error('Copy failed'));
  };

  const handleDownloadPDF = () => {
    if (!results) {
      toast.error('No disclosure data. Calculate a contract first.');
      return;
    }
    const blob = new Blob([generateDisclosureText()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IFRS15_Disclosure_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Disclosure downloaded!');
  };

  return (
    <SidebarLayout pageTitle="IFRS 15 — Revenue Recognition" pageSubtitle="5-step model for revenue recognition from customer contracts">
      {/* Module Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        {moduleCards.map((m) => (
          <div
            key={m.id}
            onClick={() => setActiveModule(activeModule === m.id ? null : m.id)}
            className={`bg-gradient-to-br ${m.gradient} rounded-card p-4 text-white cursor-pointer hover:shadow-lg transition-shadow ${activeModule === m.id ? 'ring-2 ring-white ring-offset-2' : ''}`}
          >
            <p className="text-sm font-semibold">{m.name}</p>
          </div>
        ))}
      </div>

      {/* Module content – expand when a card is clicked (same pattern as IFRS 16) */}
      {activeModule && (
        <div className="bg-white rounded-card p-6 border border-border-default shadow-card mb-8">
          {activeModule === 'contract-identification' && (
            <>
              <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Contract Identification</h3>
                <p className="text-xs text-text-muted mt-1">Contract details from results</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><span className="text-xs text-text-muted">Contract ID</span><p className="text-sm font-medium text-text-primary mt-1">{contractId}</p></div>
                <div><span className="text-xs text-text-muted">Customer Name</span><p className="text-sm font-medium text-text-primary mt-1">{customerName}</p></div>
                <div><span className="text-xs text-text-muted">Contract Date</span><p className="text-sm font-medium text-text-primary mt-1">{contractDate}</p></div>
                <div><span className="text-xs text-text-muted">Contract Term / Duration</span><p className="text-sm font-medium text-text-primary mt-1">{contractTerm === '—' ? '—' : `${contractTerm} months`}</p></div>
                <div><span className="text-xs text-text-muted">Transaction Price / Contract Value</span><p className="text-sm font-medium text-text-primary mt-1">{results ? formatCurrency(tp, currency, 0) : (step1.total_contract_value ? formatCurrency(Number(step1.total_contract_value), sanitizeCurrencyCode(step1.currency, 'USD'), 0) : '—')}</p></div>
              </div>
            </>
          )}
          {activeModule === 'performance-obligations' && (
            <>
              <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Performance Obligations</h3>
                <p className="text-xs text-text-muted mt-1">Identified obligations and allocation</p>
              </div>
              {(perfObs.length > 0 || Object.keys(allocations).length > 0) ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border-default">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Obligation</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Allocation Value</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Recognition Type</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perfObs.length > 0 ? perfObs.map((p: any) => {
                        const rec = p.recognition_method === 'point_in_time' ? 'Point in Time' : 'Over Time';
                        const status = (p.revenue_recognized ?? 0) > 0 ? 'Recognised' : 'Deferred';
                        return (
                          <tr key={p.obligation_id || p.obligation} className="border-b border-border-default hover:bg-orange-light">
                            <td className="py-2 px-3 text-sm text-text-primary">{p.obligation || p.obligation_id}</td>
                            <td className="py-2 px-3 text-sm text-right font-semibold amount">{formatCurrency(Number(p.allocated_amount ?? 0), currency, 0)}</td>
                            <td className="py-2 px-3 text-sm text-text-primary">{rec}</td>
                            <td className="py-2 px-3">
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${status === 'Recognised' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{status}</span>
                            </td>
                          </tr>
                        );
                      }) : Object.entries(allocations).map(([id, amt]) => (
                        <tr key={id} className="border-b border-border-default hover:bg-orange-light">
                          <td className="py-2 px-3 text-sm text-text-primary">{id}</td>
                          <td className="py-2 px-3 text-sm text-right font-semibold amount">{formatCurrency(Number(amt), currency, 0)}</td>
                          <td className="py-2 px-3 text-sm text-text-muted">—</td>
                          <td className="py-2 px-3 text-sm text-text-muted">—</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-text-muted">Upload and calculate a contract to see performance obligations.</p>
              )}
            </>
          )}
          {activeModule === 'transaction-price' && (
            <>
              <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Transaction Price</h3>
                <p className="text-xs text-text-muted mt-1">Step 3 – Determine transaction price</p>
              </div>
              <div className="p-4 bg-orange-light rounded-lg border border-orange-border space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-text-primary">Total transaction price</span>
                  <span className="text-lg font-bold text-orange-primary amount">{results ? formatCurrency(tp, currency, 0) : '—'}</span>
                </div>
                <div className="flex justify-between items-center text-sm text-text-secondary">
                  <span>Variable consideration</span>
                  <span className="amount">{results ? formatCurrency(disclosureData?.transaction_price_components?.variable_consideration ?? 0, currency, 0) : '—'}</span>
                </div>
                <div className="flex justify-between items-center text-sm text-text-secondary">
                  <span>Currency</span>
                  <span className="font-medium">{currency}</span>
                </div>
                <div className="flex justify-between items-center text-sm text-text-secondary">
                  <span>Payment terms</span>
                  <span>{extractedData?.step3_transaction_price?.significant_financing_component?.payment_terms_exceed_one_year ? 'Exceeds 1 year' : (results ? 'Per contract' : '—')}</span>
                </div>
                {disclosureData?.transaction_price_components && (
                  <div className="pt-2 mt-2 border-t border-orange-border space-y-1 text-sm text-text-secondary">
                    <div className="flex justify-between"><span>Fixed consideration</span><span className="amount">{formatCurrency(disclosureData.transaction_price_components.fixed_consideration ?? 0, currency, 0)}</span></div>
                  </div>
                )}
              </div>
            </>
          )}
          {activeModule === 'price-allocation' && (
            <>
              <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Price Allocation</h3>
                <p className="text-xs text-text-muted mt-1">Step 4 – Allocate transaction price to obligations (SSP method)</p>
              </div>
              {(perfObs.length > 0 || Object.keys(allocations).length > 0) ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border-default">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Obligation</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Allocated amount</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">% of total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perfObs.length > 0 ? perfObs.map((p: any) => {
                        const amt = Number(p.allocated_amount ?? 0);
                        const pct = tp > 0 ? ((amt / tp) * 100).toFixed(1) : '0';
                        return (
                          <tr key={p.obligation_id || p.obligation} className="border-b border-border-default hover:bg-orange-light">
                            <td className="py-2 px-3 text-sm text-text-primary">{p.obligation || p.obligation_id}</td>
                            <td className="py-2 px-3 text-sm text-right font-semibold amount">{formatCurrency(amt, currency, 0)}</td>
                            <td className="py-2 px-3 text-sm text-right text-text-secondary">{pct}%</td>
                          </tr>
                        );
                      }) : Object.entries(allocations).map(([id, amt]) => {
                        const pct = tp > 0 ? ((Number(amt) / tp) * 100).toFixed(1) : '0';
                        return (
                          <tr key={id} className="border-b border-border-default hover:bg-orange-light">
                            <td className="py-2 px-3 text-sm text-text-primary">{id}</td>
                            <td className="py-2 px-3 text-sm text-right font-semibold amount">{formatCurrency(Number(amt), currency, 0)}</td>
                            <td className="py-2 px-3 text-sm text-right text-text-secondary">{pct}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-text-muted">Calculate a contract to see allocation.</p>
              )}
            </>
          )}
          {activeModule === 'revenue-recognition' && (
            <>
              <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Revenue Recognition</h3>
                <p className="text-xs text-text-muted mt-1">Step 5 – Recognise revenue when/as obligations are satisfied</p>
              </div>
              {results ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between p-3 hover:bg-green-50 rounded-lg border-l-4 border-green-500">
                      <span className="text-sm text-text-secondary">Revenue Recognised</span>
                      <span className="font-bold text-green-600 amount">{formatCurrency(rec, currency, 0)}</span>
                    </div>
                    <div className="flex justify-between p-3 hover:bg-amber-50 rounded-lg border-l-4 border-amber-500">
                      <span className="text-sm text-text-secondary">Deferred Revenue</span>
                      <span className="font-bold text-amber-600 amount">{formatCurrency(def, currency, 0)}</span>
                    </div>
                    <div className="flex justify-between p-3">
                      <span className="text-sm text-text-secondary">Effective Revenue Rate</span>
                      <span className="font-bold text-text-primary">{effectiveRevenueRate}%</span>
                    </div>
                  </div>
                  {schedule?.length > 0 && (
                    <>
                      <h4 className="text-sm font-semibold text-text-primary mt-4">Revenue Schedule</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-border-default">
                              <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Period</th>
                              <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Obligation</th>
                              <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Amount</th>
                              <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Date</th>
                              <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {schedule.map((row: any, idx: number) => {
                              const rev = Number(row.Revenue ?? row.revenue ?? 0);
                              const status = rev > 0 ? 'Recognised' : 'Deferred';
                              return (
                                <tr key={idx} className="border-b border-border-default hover:bg-orange-light">
                                  <td className="py-2 px-3 text-sm text-text-primary">{row.Period ?? row.Month ?? row.period ?? idx + 1}</td>
                                  <td className="py-2 px-3 text-sm text-text-primary">{row.Obligation ?? row.obligation ?? row.Obligation_ID ?? row.obligation_id ?? '—'}</td>
                                  <td className="py-2 px-3 text-sm text-right font-semibold amount">{formatCurrency(rev, currency, 0)}</td>
                                  <td className="py-2 px-3 text-sm text-text-secondary">{row.Date ?? row.date ?? '—'}</td>
                                  <td className="py-2 px-3">
                                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${status === 'Recognised' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{status}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-text-muted">Calculate a contract to see recognition.</p>
              )}
            </>
          )}
          {activeModule === 'contract-modifications' && (
            <>
              <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Contract Modifications</h3>
                <p className="text-xs text-text-muted mt-1">Contract modification history</p>
              </div>
              {(results?.modifications ?? results?.disclosure_data?.contract_modifications ?? []).length > 0 ? (
                <ul className="space-y-2 list-disc list-inside text-sm text-text-primary">
                  {(results.modifications || results.disclosure_data?.contract_modifications || []).map((m: any, i: number) => (
                    <li key={i}>{typeof m === 'string' ? m : (m.description || m.date || JSON.stringify(m))}</li>
                  ))}
                </ul>
              ) : (
                <div className="p-4 bg-bg-light rounded-lg border border-border-default text-center">
                  <p className="text-sm text-text-muted">No modifications detected.</p>
                </div>
              )}
            </>
          )}
          {activeModule === 'disclosures' && (
            <>
              <div className="flex items-center justify-between border-b border-border-default pb-4 mb-6">
                <h3 className="text-lg font-bold text-text-primary">IFRS 15 DISCLOSURE NOTES</h3>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={handleCopyDisclosure} className="bg-white border border-border-default">
                    <Copy className="w-4 h-4 mr-2" /> Copy
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleDownloadPDF} className="bg-white border border-border-default">
                    <Download className="w-4 h-4 mr-2" /> Download PDF
                  </Button>
                </div>
              </div>
              {results ? (
                <pre className="whitespace-pre-wrap text-sm text-text-primary font-sans">{generateDisclosureText()}</pre>
              ) : (
                <p className="text-text-muted text-center py-8">Calculate a contract to generate disclosures.</p>
              )}
            </>
          )}
        </div>
      )}

      {/* KPI Cards - same style as IFRS 16 */}
      {results && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-card p-5 border border-border-default shadow-card">
          <div className="h-1 bg-gradient-orange rounded-t-full -mt-5 -mx-5 mb-4"></div>
          <h4 className="text-sm font-medium text-text-secondary mb-2">Total Contracts</h4>
            <p className="text-2xl font-bold text-text-primary amount">1</p>
        </div>
        <div className="bg-white rounded-card p-5 border border-border-default shadow-card">
          <div className="h-1 bg-gradient-pink rounded-t-full -mt-5 -mx-5 mb-4"></div>
          <h4 className="text-sm font-medium text-text-secondary mb-2">Total Revenue</h4>
            <p className="text-2xl font-bold text-text-primary amount">{formatCurrency(tp, currency, 0)}</p>
        </div>
        <div className="bg-white rounded-card p-5 border border-border-default shadow-card">
          <div className="h-1 bg-gradient-amber rounded-t-full -mt-5 -mx-5 mb-4"></div>
            <h4 className="text-sm font-medium text-text-secondary mb-2">Recognised Revenue</h4>
            <p className="text-2xl font-bold text-text-primary amount">{formatCurrency(rec, currency, 0)}</p>
        </div>
        <div className="bg-white rounded-card p-5 border border-border-default shadow-card">
          <div className="h-1 bg-gradient-orange rounded-t-full -mt-5 -mx-5 mb-4"></div>
          <h4 className="text-sm font-medium text-text-secondary mb-2">Deferred Revenue</h4>
            <p className="text-2xl font-bold text-text-primary amount">{formatCurrency(def, currency, 0)}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-6">
          {/* Upload + AI Extraction */}
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
              <h3 className="text-base font-bold text-text-primary">Upload + AI Extraction</h3>
              <p className="text-xs text-text-muted mt-1">Upload revenue contract (PDF, DOCX, XLSX)</p>
            </div>
            <div className="flex gap-4 mb-6 border-b border-border-default">
              <button
                onClick={() => setActiveTab('upload')}
                className={`px-4 py-2 font-medium text-sm border-b-2 ${activeTab === 'upload' ? 'border-orange-primary text-orange-primary' : 'border-transparent text-text-secondary'}`}
              >
                <div className="flex items-center gap-2"><Upload className="w-4 h-4" /> Upload</div>
              </button>
              <button
                onClick={() => setActiveTab('manual')}
                className={`px-4 py-2 font-medium text-sm border-b-2 ${activeTab === 'manual' ? 'border-orange-primary text-orange-primary' : 'border-transparent text-text-secondary'}`}
              >
                <div className="flex items-center gap-2"><FileText className="w-4 h-4" /> Paste Text</div>
              </button>
            </div>

            {activeTab === 'upload' && (
              <div
                className="border-2 border-dashed border-orange-primary rounded-lg p-12 text-center hover:bg-orange-light/30 cursor-pointer"
                onClick={() => document.getElementById('ifrs15-file')?.click()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) handleFileSelect({ target: { files: [f] } } as any);
                }}
                onDragOver={(e) => e.preventDefault()}
            >
              <Upload className="w-16 h-16 text-orange-primary mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2 text-text-primary">Drop revenue contract here</h3>
                <p className="text-sm text-text-muted mb-6">Supports PDF, DOCX, TXT, Excel (.xlsx, .xls)</p>
                <input type="file" id="ifrs15-file" accept=".pdf,.docx,.txt,.xlsx,.xls" className="hidden" onChange={handleFileSelect} />
                {file && !isUploading && <p className="text-sm text-text-primary font-medium">{file.name}</p>}
                {isUploading && <div className="flex items-center justify-center gap-2 text-orange-primary"><Loader2 className="w-4 h-4 animate-spin" /> Extracting...</div>}
            </div>
            )}

            {activeTab === 'manual' && (
            <div>
                <label className="block text-sm font-medium text-text-primary mb-2">Paste contract text</label>
              <textarea
                value={contractText}
                onChange={(e) => setContractText(e.target.value)}
                  rows={8}
                  className="w-full px-4 py-3 bg-bg-light border border-border-default rounded-lg focus:ring-2 focus:ring-orange-primary text-text-primary"
                  placeholder="Paste revenue contract text..."
                />
                <Button
                  variant="primary"
                  size="md"
                  className="mt-4 w-full bg-gradient-orange"
                  onClick={async () => {
                    if (!contractText.trim()) {
                      toast.error('Please paste contract text');
                      return;
                    }
                    setIsUploading(true);
                    try {
                      const response = await ifrs15Api.extract(contractText) as any;
                      const { data, error } = response;
                      if (error) throw new Error(error);
                      setExtractedData(data?.extracted_data);
                      const vc = data?.extracted_data?.step3_transaction_price?.variable_consideration || {};
                      setVcConstraint({
                        constraint_method: vc.constraint_method ?? 'percentage',
                        constraint_percentage: Number(vc.constraint_percentage ?? 100),
                        variable_consideration_constrained: Number(vc.variable_consideration_constrained ?? 0),
                      });
                      toast.success('Contract extracted successfully!');
                    } catch (e: any) {
                      toast.error(e?.message || 'Extraction failed');
                    } finally {
                      setIsUploading(false);
                    }
                  }}
                  disabled={!contractText.trim()}
                  isLoading={isUploading}
                >
                Analyze Contract
              </Button>

              <div className="mb-6 mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <label className="font-semibold text-gray-800 mb-3 block">
                  Contract Type
                  <span className="ml-2 text-xs text-blue-500">IFRS 15 §31-38</span>
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { key: 'time_and_material', label: '⏱ Time & Material', desc: 'Hours × Rate' },
                    { key: 'fixed_price', label: '📋 Fixed Price (POC)', desc: 'Cost-to-cost method' },
                    { key: 'capped_tm', label: '🔒 Capped T&M', desc: 'T&M with maximum cap' },
                    { key: 'maintenance', label: '🔧 Maintenance', desc: 'Straight-line' },
                  ].map((ct) => (
                    <button
                      key={ct.key}
                      onClick={() => updateStep3({ contract_type: ct.key })}
                      type="button"
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        step3.contract_type === ct.key
                          ? 'border-orange-500 bg-orange-50'
                          : 'border-gray-200 bg-white hover:border-orange-300'
                      }`}
                    >
                      <div className="font-semibold text-sm">{ct.label}</div>
                      <div className="text-xs text-gray-500 mt-1">{ct.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {step3.contract_type === 'time_and_material' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-text-primary mb-1">Hours Worked</label>
                    <input type="number" value={step3.hours_worked} onChange={(e) => updateStep3({ hours_worked: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm text-text-primary mb-1">Hourly Rate ($)</label>
                    <input type="number" value={step3.hourly_rate} onChange={(e) => updateStep3({ hourly_rate: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                </div>
              )}

              {(step3.contract_type === 'fixed_price' || step3.contract_type === 'capped_tm') && (
                <div className="grid grid-cols-3 gap-4 mt-4">
                  <div>
                    <label className="block text-sm text-text-primary mb-1">Total Estimated Cost</label>
                    <input type="number" value={step3.total_estimated_cost} onChange={(e) => updateStep3({ total_estimated_cost: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm text-text-primary mb-1">Actual Cost to Date</label>
                    <input type="number" value={step3.actual_cost_to_date} onChange={(e) => updateStep3({ actual_cost_to_date: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm text-text-primary mb-1">Prior Revenue Recognised</label>
                    <input type="number" value={step3.prior_revenue_recognised} onChange={(e) => updateStep3({ prior_revenue_recognised: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                </div>
              )}

              {step3.contract_type === 'capped_tm' && (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-sm text-text-primary mb-1">T&M Cap Amount</label>
                    <input type="number" value={step3.tm_cap} onChange={(e) => updateStep3({ tm_cap: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm text-text-primary mb-1">Cumulative Billed to Date</label>
                    <input type="number" value={step3.cumulative_billed} onChange={(e) => updateStep3({ cumulative_billed: e.target.value })} className="w-full px-3 py-2 border border-border-default rounded-lg" />
                  </div>
                </div>
              )}

              <div className="mt-6">
                <button onClick={() => setShowSLA(!showSLA)} className="text-sm font-semibold text-blue-600 flex items-center gap-2" type="button">
                  {showSLA ? '▲' : '▼'}
                  SLA Penalties / Credits (optional)
                  <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">Reduces Revenue</span>
                </button>

                {showSLA && (
                  <div className="mt-3 space-y-3">
                    {slaItems.map((sla, i) => (
                      <div key={i} className="grid grid-cols-4 gap-3 p-3 bg-red-50 rounded-lg">
                        <input placeholder="SLA Name" value={sla.name} onChange={(e) => setSlaItems((prev) => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} className="px-2 py-1 border rounded" />
                        <input placeholder="Target %" type="number" value={sla.target} onChange={(e) => setSlaItems((prev) => prev.map((x, idx) => idx === i ? { ...x, target: e.target.value } : x))} className="px-2 py-1 border rounded" />
                        <input placeholder="Actual %" type="number" value={sla.actual} onChange={(e) => setSlaItems((prev) => prev.map((x, idx) => idx === i ? { ...x, actual: e.target.value } : x))} className="px-2 py-1 border rounded" />
                        <input placeholder="Monthly Fee" type="number" value={sla.monthly_fee} onChange={(e) => setSlaItems((prev) => prev.map((x, idx) => idx === i ? { ...x, monthly_fee: e.target.value } : x))} className="px-2 py-1 border rounded" />
                      </div>
                    ))}
                    <button onClick={addSLAItem} className="text-sm text-blue-600" type="button">
                      + Add SLA
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-6">
                <button onClick={() => setShowVolumeDiscount(!showVolumeDiscount)} className="text-sm font-semibold text-blue-600 flex items-center gap-2" type="button">
                  {showVolumeDiscount ? '▲' : '▼'}
                  Volume Discounts (optional)
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Variable Consideration</span>
                </button>

                {showVolumeDiscount && (
                  <div className="mt-3 space-y-3">
                    {volumeSlabs.map((slab, i) => (
                      <div key={i} className="grid grid-cols-3 gap-3 p-3 bg-amber-50 rounded-lg">
                        <input placeholder="Min Volume $" type="number" value={slab.min_volume} onChange={(e) => setVolumeSlabs((prev) => prev.map((x, idx) => idx === i ? { ...x, min_volume: e.target.value } : x))} className="px-2 py-1 border rounded" />
                        <input placeholder="Max Volume $" type="number" value={slab.max_volume} onChange={(e) => setVolumeSlabs((prev) => prev.map((x, idx) => idx === i ? { ...x, max_volume: e.target.value } : x))} className="px-2 py-1 border rounded" />
                        <input placeholder="Discount %" type="number" value={slab.discount_pct} onChange={(e) => setVolumeSlabs((prev) => prev.map((x, idx) => idx === i ? { ...x, discount_pct: e.target.value } : x))} className="px-2 py-1 border rounded" />
                      </div>
                    ))}
                    <button onClick={addVolumeSlab} className="text-sm text-blue-600" type="button">
                      + Add Slab
                    </button>

                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={step3.can_estimate_volume} onChange={(e) => updateStep3({ can_estimate_volume: e.target.checked })} />
                      <label className="text-sm">I can estimate annual volume</label>
                    </div>

                    {step3.can_estimate_volume && (
                      <input placeholder="Estimated annual volume $" type="number" value={step3.estimated_annual_volume} onChange={(e) => updateStep3({ estimated_annual_volume: e.target.value })} className="w-full px-3 py-2 border rounded-lg" />
                    )}

                    {!step3.can_estimate_volume && (
                      <p className="text-xs text-amber-700">
                        ⚠ Maximum discount will be applied (conservative — IFRS 15 §56)
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
            )}

            {extractedData && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <h4 className="font-semibold text-green-700 mb-3 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Extraction complete</h4>
                <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                  <div><span className="text-text-muted">Customer Name:</span> {step1.customer_name || '—'}</div>
                  <div><span className="text-text-muted">Contract Date:</span> {step1.effective_date || '—'}</div>
                  <div>
                    <span className="text-text-muted">Contract Value:</span>{' '}
                    {formatCurrency(
                      step1.total_contract_value ?? extractedData?.step3_transaction_price?.total_transaction_price ?? 0,
                      sanitizeCurrencyCode(step1.currency, 'USD'),
                      0
                    )}
                  </div>
                  <div><span className="text-text-muted"># POBs:</span> {extractedData?.step2_performance_obligations?.total_obligations_count ?? 0}</div>
                  <div><span className="text-text-muted">Payment Terms:</span> {extractedData?.step3_transaction_price?.significant_financing_component?.payment_terms_exceed_one_year ? 'Exceeds 1 year' : (extractedData?.step3_transaction_price ? 'Per contract' : '—')}</div>
                  <div><span className="text-text-muted">Duration:</span> {step1.contract_term_months ?? '—'} months</div>
                </div>
                <div className="p-3 bg-white rounded border border-green-200 mb-4">
                  <p className="text-sm font-medium text-text-primary mb-2">Variable Consideration Constraint (IFRS 15 §56-58)</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-text-muted">Constraint Method</label>
                      <select
                        className="w-full border rounded px-2 py-1 text-sm"
                        value={vcConstraint.constraint_method}
                        onChange={(e) => setVcConstraint((p) => ({ ...p, constraint_method: e.target.value }))}
                      >
                        <option value="percentage">% Highly Probable</option>
                        <option value="amount">Fixed Amount</option>
                      </select>
                    </div>
                    {vcConstraint.constraint_method === 'percentage' ? (
                      <div>
                        <label className="text-xs text-text-muted">Highly Probable %</label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          className="w-full border rounded px-2 py-1 text-sm"
                          value={vcConstraint.constraint_percentage}
                          onChange={(e) => setVcConstraint((p) => ({ ...p, constraint_percentage: parseFloat(e.target.value) || 100 }))}
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="text-xs text-text-muted">Constrained Amount</label>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="w-full border rounded px-2 py-1 text-sm"
                          value={vcConstraint.variable_consideration_constrained}
                          onChange={(e) => setVcConstraint((p) => ({ ...p, variable_consideration_constrained: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                    )}
                  </div>
                  {vcConstraint.constraint_method === 'percentage' && vcConstraint.constraint_percentage < 100 && (
                    <p className="text-xs text-amber-600 mt-2">
                      VC constrained to {vcConstraint.constraint_percentage}% - {((extractedVariableAmount || 0) * (vcConstraint.constraint_percentage / 100)).toFixed(2)} included, {((extractedVariableAmount || 0) * (1 - vcConstraint.constraint_percentage / 100)).toFixed(2)} excluded.
                    </p>
                  )}
                </div>
                <Button variant="primary" size="md" onClick={() => handleCalculate()} isLoading={isCalculating}>
                  <Calculator className="w-4 h-4" /> Calculate with Extracted Data
                </Button>
              </div>
            )}
          </div>

          {/* 5-Step Checklist with real data - same as IFRS 16 */}
          {(extractedData || results) && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
              <h3 className="text-base font-bold text-text-primary">5-Step IFRS 15 Checklist</h3>
              <p className="text-xs text-text-muted mt-1">Complete all steps for revenue recognition</p>
            </div>
            <div className="space-y-4">
              <div className={`flex items-center gap-4 p-4 rounded-lg border-2 ${stepStatus.step1 ? 'bg-green-50 border-green-200' : 'bg-bg-light border-border-default'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${stepStatus.step1 ? 'bg-green-500 text-white' : 'bg-orange-primary text-white'}`}>1</div>
                <div className="flex-1">
                    <span className="font-semibold text-text-primary">Identify the contract</span>
                    {stepStatus.step1 && <CheckCircle2 className="w-5 h-5 text-green-600 inline ml-2" />}
                    {stepStatus.step1 && customerName && <p className="text-sm text-text-muted mt-1">— {customerName}</p>}
                  </div>
                </div>
              <div className={`flex items-center gap-4 p-4 rounded-lg border-2 ${stepStatus.step2 ? 'bg-green-50 border-green-200' : 'bg-bg-light border-border-default'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${stepStatus.step2 ? 'bg-green-500 text-white' : 'bg-orange-primary text-white'}`}>2</div>
                <div className="flex-1">
                    <span className="font-semibold text-text-primary">Identify performance obligations</span>
                    {stepStatus.step2 && <CheckCircle2 className="w-5 h-5 text-green-600 inline ml-2" />}
                    {stepStatus.step2 && <p className="text-sm text-text-muted mt-1">— {numPOBs} obligation{numPOBs !== 1 ? 's' : ''}</p>}
                  </div>
                </div>
              <div className={`flex items-center gap-4 p-4 rounded-lg border-2 ${stepStatus.step3 ? 'bg-green-50 border-green-200' : 'bg-bg-light border-border-default'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${stepStatus.step3 ? 'bg-green-500 text-white' : 'bg-orange-primary text-white'}`}>3</div>
                <div className="flex-1">
                    <span className="font-semibold text-text-primary">Determine transaction price</span>
                    {stepStatus.step3 && <CheckCircle2 className="w-5 h-5 text-green-600 inline ml-2" />}
                    {stepStatus.step3 && results && <p className="text-sm text-text-muted mt-1">— {formatCurrency(tp, currency, 0)}</p>}
                  </div>
                </div>
              <div className={`flex items-center gap-4 p-4 rounded-lg border-2 ${stepStatus.step4 ? 'bg-green-50 border-green-200' : 'bg-bg-light border-border-default'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${stepStatus.step4 ? 'bg-green-500 text-white' : 'bg-orange-primary text-white'}`}>4</div>
                <div className="flex-1">
                    <span className="font-semibold text-text-primary">Allocate transaction price</span>
                    {stepStatus.step4 && <CheckCircle2 className="w-5 h-5 text-green-600 inline ml-2" />}
                    {stepStatus.step4 && <p className="text-sm text-text-muted mt-1">— {numPOBs} obligation{numPOBs !== 1 ? 's' : ''}</p>}
                  </div>
                </div>
              <div className={`flex items-center gap-4 p-4 rounded-lg border-2 ${stepStatus.step5 ? 'bg-green-50 border-green-200' : 'bg-bg-light border-border-default'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${stepStatus.step5 ? 'bg-green-500 text-white' : 'bg-orange-primary text-white'}`}>5</div>
                <div className="flex-1">
                    <span className="font-semibold text-text-primary">Recognise revenue</span>
                    {stepStatus.step5 ? <CheckCircle2 className="w-5 h-5 text-green-600 inline ml-2" /> : <Clock className="w-5 h-5 text-amber-500 inline ml-2" />}
                    <p className="text-sm text-text-muted mt-1">{stepStatus.step5 && results ? `— ${formatCurrency(rec, currency, 0)} recognised` : '— Pending recognition'}</p>
                  </div>
                </div>
              </div>
              {!results && extractedData && (
                <Button variant="primary" size="lg" className="w-full mt-6 bg-gradient-orange hover:opacity-90" onClick={() => handleCalculate()} isLoading={isCalculating}>
                  <Calculator className="w-5 h-5" /> Calculate with Extracted Data
                </Button>
              )}
            </div>
          )}

          {/* Results - same level of detail as IFRS 16 */}
          {results && (
            <>
              {results?.revenue_engine_result && (
                <div className="p-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-blue-900">Revenue Engine Result</h3>
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded font-medium">
                      {results?.revenue_engine_result?.method}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-xs text-gray-500">Revenue This Period</div>
                      <div className="text-2xl font-bold text-blue-700">
                        ${results?.revenue_engine_result?.revenue_this_period?.toLocaleString?.()}
                      </div>
                    </div>

                    {results?.revenue_engine_result?.poc_percentage != null && (
                      <div>
                        <div className="text-xs text-gray-500">POC %</div>
                        <div className="text-2xl font-bold text-green-700">
                          {results?.revenue_engine_result?.poc_percentage}%
                        </div>
                        <div className="mt-1 h-2 bg-gray-200 rounded-full">
                          <div
                            className="h-2 bg-green-500 rounded-full"
                            style={{ width: `${results?.revenue_engine_result?.poc_percentage}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {results?.revenue_engine_result?.remaining_revenue != null && (
                      <div>
                        <div className="text-xs text-gray-500">Remaining Revenue</div>
                        <div className="text-2xl font-bold text-orange-600">
                          ${results?.revenue_engine_result?.remaining_revenue?.toLocaleString?.()}
                        </div>
                      </div>
                    )}
                  </div>

                  {results?.revenue_engine_result?.formula && (
                    <div className="mt-3 p-2 bg-blue-900 rounded text-xs text-white font-mono text-center">
                      📐 {results?.revenue_engine_result?.formula}
                    </div>
                  )}

                  {results?.onerous_check?.is_onerous && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-300 rounded-lg">
                      <div className="font-bold text-red-700">⚠ ONEROUS CONTRACT DETECTED</div>
                      <div className="text-sm text-red-600 mt-1">
                        Expected loss: ${results?.onerous_check?.expected_loss?.toLocaleString?.()} — Provision required immediately (IAS 37)
                      </div>
                    </div>
                  )}

                  {results?.revenue_engine_result?.switched_to_poc && (
                    <div className="mt-3 p-2 bg-amber-50 border border-amber-300 rounded text-sm text-amber-700">
                      🔒 Cap exceeded by ${results?.revenue_engine_result?.cap_exceeded_by?.toLocaleString?.()} — Switched from T&M to POC method
                    </div>
                  )}
                </div>
              )}

              {results?.sla_result?.total_penalty > 0 && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl mb-4">
                  <h3 className="font-bold text-red-800 mb-2">SLA Penalties — Negative Revenue</h3>
                  <div className="text-2xl font-bold text-red-700 mb-2">
                    −${results?.sla_result?.total_penalty?.toLocaleString?.()}
                  </div>
                  <div className="space-y-1">
                    {results?.sla_result?.sla_details
                      ?.filter((s: any) => s?.breach)
                      ?.map((s: any, i: number) => (
                        <div key={i} className="text-sm text-red-600">
                          • {s?.sla_name}: target {s?.target}%, actual {s?.actual}% → penalty ${s?.penalty?.toFixed?.(0)}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                <div className="border-b border-border-default pb-4 mb-6">
                  <h3 className="text-base font-bold text-text-primary">Calculation Results</h3>
                  <p className="text-xs text-text-muted mt-1">IFRS 15 revenue recognition metrics</p>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 hover:bg-orange-light rounded-lg border-l-4 border-orange-primary transition-colors">
                    <span className="text-sm text-text-secondary">Total Contract Value</span>
                    <span className="text-base font-bold text-orange-primary amount">{formatCurrency(tp, currency, 0)}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 hover:bg-green-50 rounded-lg border-l-4 border-green-500 transition-colors">
                    <span className="text-sm text-text-secondary">Total Revenue Recognised</span>
                    <span className="text-base font-bold text-green-600 amount">{formatCurrency(rec, currency, 0)}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 hover:bg-amber-50 rounded-lg border-l-4 border-amber-500 transition-colors">
                    <span className="text-sm text-text-secondary">Deferred Revenue (Contract Liability)</span>
                    <span className="text-base font-bold text-amber-600 amount">{formatCurrency(def, currency, 0)}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 hover:bg-blue-50 rounded-lg border-l-4 border-blue-500 transition-colors">
                    <span className="text-sm text-text-secondary">Contract Asset</span>
                    <span className="text-base font-bold text-blue-600 amount">{formatCurrency(balances.contract_asset_amount || 0, currency, 0)}</span>
                  </div>
                  <div className="flex justify-between items-center p-3 hover:bg-orange-light rounded-lg border-l-4 border-orange-primary transition-colors">
                    <span className="text-sm text-text-secondary">Effective Revenue Rate</span>
                    <span className="text-base font-bold text-orange-primary amount">{effectiveRevenueRate}%</span>
                  </div>
                  <div className="flex justify-between items-center p-3 hover:bg-bg-light rounded-lg border-l-4 border-border-default transition-colors">
                    <span className="text-sm text-text-secondary">Number of Performance Obligations</span>
                    <span className="text-base font-bold text-text-primary">{numPOBs}</span>
              </div>
            </div>
          </div>

              {Object.keys(allocations).length > 0 && (
                <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
                  <h3 className="text-base font-bold text-text-primary mb-4">Revenue per Obligation</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border-default">
                          <th className="text-left py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Obligation</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-text-secondary uppercase">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(allocations).map(([id, amt]) => (
                          <tr key={id} className="border-b border-border-default hover:bg-orange-light">
                            <td className="py-2 px-3 text-sm text-text-primary">{id}</td>
                            <td className="py-2 px-3 text-sm text-right font-semibold amount">{formatCurrency(Number(amt), currency, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Revenue Recognition Schedule Table - same style as IFRS 16 amortization */}
              {schedule.length > 0 && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
              <h3 className="text-base font-bold text-text-primary">Revenue Recognition Schedule</h3>
                    <p className="text-xs text-text-muted mt-1">Revenue by period and obligation</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Period</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Contract ID</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Performance Obligation</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Revenue Amount</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Recognised Date</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Opening Balance</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Closing Balance</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-text-secondary uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                        {(scheduleViewAll ? schedule : schedule.slice(0, 6)).map((row: any, idx: number) => {
                          const rev = row.Revenue || 0;
                          const cum = row.Cumulative ?? rev;
                          const opening = cum - rev;
                          const isRecognised = rev > 0;
                          return (
                            <tr
                              key={idx}
                              className={`border-b border-border-default hover:bg-orange-light transition-colors ${isRecognised ? 'bg-orange-50/50' : 'bg-amber-50/30'}`}
                            >
                              <td className="py-3 px-4 text-sm text-text-primary">{row.Month || row.Date || row.Period}</td>
                              <td className="py-3 px-4 text-sm text-text-primary">{contractId}</td>
                              <td className="py-3 px-4 text-sm text-text-primary">{row.Obligation || row.Obligation_ID}</td>
                              <td className="py-3 px-4 text-sm text-right font-semibold amount">{formatCurrency(rev, currency, 0)}</td>
                              <td className="py-3 px-4 text-sm text-text-secondary">{row.Date || row.Month || '—'}</td>
                              <td className="py-3 px-4 text-sm text-right text-text-primary amount">{formatCurrency(opening, currency, 0)}</td>
                              <td className="py-3 px-4 text-sm text-right text-text-primary amount">{formatCurrency(cum, currency, 0)}</td>
                    <td className="py-3 px-4 text-right">
                                <span className={`px-2 py-1 text-xs font-semibold rounded-full ${isRecognised ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {isRecognised ? 'Recognised' : 'Deferred'}
                                </span>
                    </td>
                  </tr>
                          );
                        })}
                </tbody>
              </table>
            </div>
                  {schedule.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setScheduleViewAll(!scheduleViewAll)}
                      className="mt-4 text-sm font-semibold text-orange-primary hover:underline"
                    >
                      {scheduleViewAll ? 'Show less' : `View All (${schedule.length} rows)`}
                    </button>
                  )}
          </div>
              )}

              {/* Download row - same as IFRS 16 */}
          <div className="flex gap-4">
                {fileId && (
                  <a href={ifrs15Api.downloadReport(fileId)} download target="_blank" rel="noopener noreferrer" className="flex-1">
                    <Button variant="primary" size="lg" className="w-full bg-gradient-orange hover:opacity-90">
                      <Download className="w-5 h-5" /> Download Excel Report
            </Button>
                  </a>
                )}
                <Button variant="secondary" size="lg" className="flex-1 bg-white border-2 border-border-default hover:bg-bg-light" onClick={handleDownloadPDF}>
                  <Download className="w-5 h-5" /> Download PDF Disclosure
            </Button>
          </div>
            </>
          )}
        </div>

        {/* Right column - same structure as IFRS 16 */}
        <div className="space-y-6">
          {/* Contract Breakdown - recognised vs deferred % like Portfolio Breakdown */}
          {results && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
                <h3 className="text-base font-bold text-text-primary">Contract Breakdown</h3>
                <p className="text-xs text-text-muted mt-1">Recognised vs deferred by contract</p>
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-2">
                    <span className="text-sm text-text-secondary">Recognised</span>
                    <span className="text-sm font-semibold text-text-primary amount">{formatCurrency(rec, currency, 0)}</span>
                </div>
                <div className="h-2 bg-bg-light rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-orange rounded-full" style={{ width: `${tp > 0 ? (rec / tp) * 100 : 0}%` }}></div>
                  </div>
              </div>
              <div>
                <div className="flex justify-between mb-2">
                    <span className="text-sm text-text-secondary">Deferred</span>
                    <span className="text-sm font-semibold text-text-primary amount">{formatCurrency(def, currency, 0)}</span>
                </div>
                <div className="h-2 bg-bg-light rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-amber rounded-full" style={{ width: `${tp > 0 ? (def / tp) * 100 : 0}%` }}></div>
              </div>
                </div>
                {Object.entries(allocations).map(([id, amt]) => {
                  const pct = (Number(amt) / (tp || 1)) * 100;
                  return (
                    <div key={id}>
                      <div className="flex justify-between mb-1"><span className="text-sm text-text-secondary">{id}</span><span className="text-sm font-semibold amount">{formatCurrency(Number(amt), currency, 0)}</span></div>
                <div className="h-2 bg-bg-light rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-orange rounded-full" style={{ width: `${pct}%` }}></div>
                      </div>
                </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Journal Entries - At inception + On recognition, same Dr/Cr styling as IFRS 16 */}
          {results && journalEntries && (
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6">
              <h3 className="text-base font-bold text-text-primary">Journal Entries</h3>
              <p className="text-xs text-text-muted mt-1">Revenue recognition entries</p>
            </div>
              <div className="space-y-4">
                <p className="text-xs font-semibold text-text-muted uppercase">At contract inception</p>
            <div className="space-y-3">
              <div className="p-3 bg-blue-50 rounded-lg border-l-4 border-blue-500">
                <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-blue-700">Dr. Accounts Receivable / Contract Asset</span>
                      <span className="text-sm font-bold text-blue-700 amount">{formatCurrency(balances.contract_asset_amount || def || 0, currency, 0)}</span>
                </div>
              </div>
              <div className="p-3 bg-green-50 rounded-lg border-l-4 border-green-500">
                <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-green-700">Cr. Contract Liability (Deferred Revenue)</span>
                      <span className="text-sm font-bold text-green-700 amount">{formatCurrency(def, currency, 0)}</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs font-semibold text-text-muted uppercase pt-2">On recognition</p>
                <div className="space-y-3">
                  {(journalEntries.revenue_recognition?.entries || []).map((e: any, i: number) => (
                    <div key={i} className={`p-3 rounded-lg border-l-4 ${e.dr > 0 ? 'bg-blue-50 border-blue-500' : 'bg-green-50 border-green-500'}`}>
                      <div className="flex justify-between items-center">
                        <span className={`text-sm font-medium ${e.dr > 0 ? 'text-blue-700' : 'text-green-700'}`}>{e.dr > 0 ? 'Dr.' : 'Cr.'} {e.account}</span>
                        <span className={`text-sm font-bold ${e.dr > 0 ? 'text-blue-700' : 'text-green-700'} amount`}>{formatCurrency(e.dr || e.cr || 0, currency, 0)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* AI Insight - dynamic based on results */}
          <div className="bg-gradient-to-br from-orange-light to-orange-light/50 rounded-card p-6 border border-orange-border shadow-card">
            <h3 className="text-base font-bold text-text-primary mb-2">AI Insight</h3>
            <p className="text-sm text-text-secondary">
              {results
                ? def > 0
                  ? `Contract ${contractId} has ${formatCurrency(def, currency, 0)} deferred revenue. Recognition completes over the contract term.`
                  : `Contract ${contractId} has recognised ${formatCurrency(rec, currency, 0)}. ${numPOBs} performance obligation${numPOBs !== 1 ? 's' : ''} applied under the 5-step model.`
                : 'Revenue contracts are analysed using the 5-step IFRS 15 model. Performance obligations are identified and transaction price is allocated using the standalone selling price method.'}
            </p>
          </div>

          {/* Disclosure Notes - full text, Copy and Download PDF */}
          <div className="bg-white rounded-card p-6 border border-border-default shadow-card">
            <div className="border-b border-border-default pb-4 mb-6 flex items-center justify-between">
              <div>
              <h3 className="text-base font-bold text-text-primary">Disclosure Notes</h3>
              <p className="text-xs text-text-muted mt-1">Required IFRS 15 disclosures</p>
              </div>
              {results && (
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={handleCopyDisclosure} className="bg-white border border-border-default hover:bg-bg-light">
                    <Copy className="w-4 h-4 mr-2" /> Copy
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleDownloadPDF} className="bg-white border border-border-default hover:bg-bg-light">
                    <Download className="w-4 h-4 mr-2" /> Download PDF
                  </Button>
              </div>
              )}
            </div>
            {results ? (
              <pre className="whitespace-pre-wrap text-sm text-text-primary font-sans leading-relaxed">{generateDisclosureText()}</pre>
            ) : (
              <p className="text-sm text-text-muted">Calculate a contract to generate disclosure notes.</p>
            )}
          </div>
        </div>
      </div>
    </SidebarLayout>
  );
}

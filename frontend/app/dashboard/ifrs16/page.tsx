'use client';

import { useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Button } from '@/components/Button';
import { Upload, FileText, Calculator, Download, ChevronRight } from 'lucide-react';
import { ifrs16Api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import toast from 'react-hot-toast';
import { formatIndianCurrency, formatIndianCurrencyWithDecimals } from '@/lib/utils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function IFRS16Page() {
  const [activeTab, setActiveTab] = useState<'upload' | 'manual'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [results, setResults] = useState<any>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const { getCompanyId } = useAuth();

  // Form state for manual entry
  const [formData, setFormData] = useState({
    lease_id: '',
    company_id: '',
    asset_description: '',
    lessee_name: '',
    lessor_name: '',
    commencement_date: '',
    lease_term_months: '',
    monthly_payment: '',
    annual_discount_rate: '',
    initial_direct_costs: '0',
    currency: 'INR',
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.match(/\.(pdf|docx|txt)$/i)) {
      toast.error('Please upload a PDF, DOCX, or TXT file');
      return;
    }

    setFile(selectedFile);
    setIsUploading(true);

    try {
      const { data, error } = await ifrs16Api.uploadContract(selectedFile);
      if (error) throw new Error(error);

      setExtractedData(data?.extracted_data);
      toast.success('Contract extracted successfully! Please review the data.');
    } catch (error) {
      toast.error('Failed to extract contract');
      console.error(error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleManualCalculate = async () => {
    setIsCalculating(true);

    try {
      const leaseData = {
        ...formData,
        company_id: getCompanyId(),
        lease_term_months: parseInt(formData.lease_term_months),
        monthly_payment: parseFloat(formData.monthly_payment),
        annual_discount_rate: parseFloat(formData.annual_discount_rate),
        initial_direct_costs: parseFloat(formData.initial_direct_costs),
      };

      const { data, error } = await ifrs16Api.calculate(leaseData);
      if (error) throw new Error(error);

      setResults(data?.results);
      setFileId(data?.excel_file_id || null);
      toast.success('Calculation completed successfully!');
    } catch (error) {
      toast.error('Failed to calculate lease');
      console.error(error);
    } finally {
      setIsCalculating(false);
    }
  };

  const prepareChartData = () => {
    if (!results?.amortization_schedule) return [];
    
    return results.amortization_schedule.slice(0, 24).map((row: any, index: number) => ({
      month: `M${index + 1}`,
      liability: parseFloat(row.closing_balance || 0),
      interest: parseFloat(row.cumulative_interest || row.interest || 0),
    }));
  };

  return (
    <DashboardLayout>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-6">
        <span>Dashboard</span>
        <ChevronRight className="w-4 h-4" />
        <span className="text-primary font-medium">IFRS 16</span>
      </div>

      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">IFRS 16 — Lease Accounting</h1>
        <p className="text-gray-600">Calculate lease liability, ROU asset, and generate audit-ready reports</p>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-gray-200">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('upload')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              activeTab === 'upload'
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Upload Contract
            </div>
          </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={`px-4 py-2 font-medium transition-colors border-b-2 ${
              activeTab === 'manual'
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Manual Entry
            </div>
          </button>
        </div>
      </div>

      {/* Upload Tab */}
      {activeTab === 'upload' && (
        <div className="bg-white rounded-lg p-8 shadow-sm border border-gray-100 mb-8">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-accent transition-colors">
            <Upload className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Drop your lease PDF here</h3>
            <p className="text-gray-600 mb-4">or click to browse</p>
            <p className="text-sm text-gray-500 mb-6">Supports PDF, DOCX, TXT</p>
            <input
              type="file"
              onChange={handleFileSelect}
              accept=".pdf,.docx,.txt"
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload">
              <Button variant="primary" size="md" isLoading={isUploading} as="span">
                {isUploading ? 'Extracting...' : 'Select File'}
              </Button>
            </label>
          </div>

          {extractedData && (
            <div className="mt-8 p-6 bg-success/10 border border-success/20 rounded-lg">
              <h4 className="font-semibold text-success mb-3">✓ Extraction Complete</h4>
              <p className="text-sm text-gray-600">
                Please review the extracted data and proceed to calculation.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Manual Entry Tab */}
      {activeTab === 'manual' && (
        <div className="bg-white rounded-lg p-8 shadow-sm border border-gray-100 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Lease ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.lease_id}
                onChange={(e) => setFormData({ ...formData, lease_id: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="LEASE-2024-001"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Asset Description <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.asset_description}
                onChange={(e) => setFormData({ ...formData, asset_description: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="Office Space - 5,000 sq ft"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Lessee Name
              </label>
              <input
                type="text"
                value={formData.lessee_name}
                onChange={(e) => setFormData({ ...formData, lessee_name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="Your Company Name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Lessor Name
              </label>
              <input
                type="text"
                value={formData.lessor_name}
                onChange={(e) => setFormData({ ...formData, lessor_name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="Landlord/Lessor Name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Lease Start Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={formData.commencement_date}
                onChange={(e) => setFormData({ ...formData, commencement_date: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Lease Term (months) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={formData.lease_term_months}
                onChange={(e) => setFormData({ ...formData, lease_term_months: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="36"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Monthly Payment (₹) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={formData.monthly_payment}
                onChange={(e) => setFormData({ ...formData, monthly_payment: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="50000"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Discount Rate (%) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.001"
                value={formData.annual_discount_rate}
                onChange={(e) => setFormData({ ...formData, annual_discount_rate: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="8.5"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Initial Direct Costs (₹)
              </label>
              <input
                type="number"
                value={formData.initial_direct_costs}
                onChange={(e) => setFormData({ ...formData, initial_direct_costs: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Currency
              </label>
              <select
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
          </div>

          <div className="mt-8">
            <Button
              variant="primary"
              size="lg"
              isLoading={isCalculating}
              onClick={handleManualCalculate}
              className="w-full"
            >
              <Calculator className="w-5 h-5" />
              Calculate IFRS 16
            </Button>
          </div>
        </div>
      )}

      {/* Results Section */}
      {results && (
        <div className="space-y-8">
          {/* Result Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
              <h4 className="text-sm font-medium text-gray-600 mb-2">Lease Liability</h4>
              <p className="text-2xl font-bold text-primary">
                {formatIndianCurrency(results.lease_liability)}
              </p>
              <p className="text-xs text-gray-500 mt-1">Present Value</p>
            </div>

            <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
              <h4 className="text-sm font-medium text-gray-600 mb-2">ROU Asset</h4>
              <p className="text-2xl font-bold text-primary">
                {formatIndianCurrency(results.rou_asset)}
              </p>
              <p className="text-xs text-gray-500 mt-1">At Recognition</p>
            </div>

            <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
              <h4 className="text-sm font-medium text-gray-600 mb-2">Monthly Interest</h4>
              <p className="text-2xl font-bold text-primary">
                {formatIndianCurrencyWithDecimals(results.year_1_impact?.interest_expense / 12 || 0, 0)}
              </p>
              <p className="text-xs text-gray-500 mt-1">Avg Year 1</p>
            </div>

            <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
              <h4 className="text-sm font-medium text-gray-600 mb-2">Monthly Depreciation</h4>
              <p className="text-2xl font-bold text-primary">
                {formatIndianCurrencyWithDecimals(results.monthly_depreciation, 0)}
              </p>
              <p className="text-xs text-gray-500 mt-1">Straight-line</p>
            </div>
          </div>

          {/* Amortization Chart */}
          <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-primary mb-4">Amortization Schedule (First 24 Months)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={prepareChartData()}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" stroke="#666" style={{ fontSize: '12px' }} />
                <YAxis stroke="#666" style={{ fontSize: '12px' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                  }}
                  formatter={(value: any) => [formatIndianCurrency(value), '']}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="liability"
                  stackId="1"
                  stroke="#6366F1"
                  fill="#6366F1"
                  name="Lease Liability"
                />
                <Area
                  type="monotone"
                  dataKey="interest"
                  stackId="2"
                  stroke="#10B981"
                  fill="#10B981"
                  name="Cumulative Interest"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Download Section */}
          {fileId && (
            <div className="bg-gradient-to-r from-accent to-accent/80 rounded-lg p-8 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold mb-2">Your audit-ready Excel report is ready</h3>
                  <p className="text-white/90">
                    Includes: Summary | Amortization | Journal Entries | Maturity Analysis | Disclosure Notes
                  </p>
                </div>
                <a
                  href={ifrs16Api.downloadReport(fileId)}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Button variant="secondary" size="lg">
                    <Download className="w-5 h-5" />
                    Download Excel Report
                  </Button>
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  );
}

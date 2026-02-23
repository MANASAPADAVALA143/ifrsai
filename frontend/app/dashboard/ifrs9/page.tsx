'use client';

import { DashboardLayout } from '@/components/DashboardLayout';
import { Button } from '@/components/Button';
import { Upload, Download, ChevronRight } from 'lucide-react';

export default function IFRS9Page() {
  return (
    <DashboardLayout>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-6">
        <span>Dashboard</span>
        <ChevronRight className="w-4 h-4" />
        <span className="text-primary font-medium">IFRS 9</span>
      </div>

      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">IFRS 9 — Expected Credit Loss</h1>
        <p className="text-gray-600">Stage classification and ECL provisioning for loan portfolios</p>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-lg p-8 shadow-sm border border-gray-100 mb-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-primary mb-2">Upload Loan Portfolio</h3>
            <p className="text-gray-600">Upload your loan portfolio data in CSV format</p>
          </div>
          <Button variant="ghost" size="sm">
            <Download className="w-4 h-4" />
            Download Sample CSV
          </Button>
        </div>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
          <Upload className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Upload Loan Portfolio (CSV)</h3>
          <p className="text-gray-600 mb-6">
            CSV should include: Loan ID, Borrower, Outstanding Balance, Days Past Due,<br />
            Current PD, LGD, Current Rating, Origination Rating
          </p>
          <Button variant="primary" size="lg">
            Select CSV File
          </Button>
        </div>
      </div>

      {/* Staging Summary Placeholder */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-gray-600">Stage 1</h4>
            <span className="px-2 py-1 bg-success/10 text-success text-xs font-semibold rounded-full">
              12-month ECL
            </span>
          </div>
          <p className="text-3xl font-bold text-primary mb-1">—</p>
          <p className="text-sm text-gray-500">Upload portfolio to view</p>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-gray-600">Stage 2</h4>
            <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-semibold rounded-full">
              Lifetime ECL
            </span>
          </div>
          <p className="text-3xl font-bold text-primary mb-1">—</p>
          <p className="text-sm text-gray-500">Upload portfolio to view</p>
        </div>

        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-gray-600">Stage 3</h4>
            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-semibold rounded-full">
              Credit Impaired
            </span>
          </div>
          <p className="text-3xl font-bold text-primary mb-1">—</p>
          <p className="text-sm text-gray-500">Upload portfolio to view</p>
        </div>
      </div>
    </DashboardLayout>
  );
}

'use client';

import { DashboardLayout } from '@/components/DashboardLayout';
import { Button } from '@/components/Button';
import { Upload, FileText, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export default function IFRS15Page() {
  const [contractText, setContractText] = useState('');

  return (
    <DashboardLayout>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-6">
        <span>Dashboard</span>
        <ChevronRight className="w-4 h-4" />
        <span className="text-primary font-medium">IFRS 15</span>
      </div>

      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">IFRS 15 — Revenue Recognition</h1>
        <p className="text-gray-600">5-step model for revenue recognition from customer contracts</p>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-lg p-8 shadow-sm border border-gray-100 mb-8">
        <h3 className="text-lg font-bold text-primary mb-4">Upload Contract or Paste Text</h3>
        
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 mb-6">
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-center text-gray-600 mb-4">Upload revenue contract (PDF/DOCX)</p>
          <div className="text-center">
            <Button variant="primary">Select File</Button>
          </div>
        </div>

        <div className="text-center text-gray-500 mb-6">— OR —</div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Paste Contract Text
          </label>
          <textarea
            value={contractText}
            onChange={(e) => setContractText(e.target.value)}
            rows={10}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
            placeholder="Paste your revenue contract text here..."
          />
        </div>

        <div className="mt-6">
          <Button variant="primary" size="lg" className="w-full">
            Analyze Contract
          </Button>
        </div>
      </div>

      {/* Results Placeholder */}
      <div className="bg-gray-50 rounded-lg p-12 text-center border-2 border-dashed border-gray-300">
        <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">Upload a contract to begin</h3>
        <p className="text-gray-500">
          AI will identify performance obligations, allocate transaction price,<br />
          and generate revenue recognition schedule
        </p>
      </div>
    </DashboardLayout>
  );
}

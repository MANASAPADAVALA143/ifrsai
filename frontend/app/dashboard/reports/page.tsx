'use client';

import { DashboardLayout } from '@/components/DashboardLayout';
import { ChevronRight, Download, FileText } from 'lucide-react';

export default function ReportsPage() {
  return (
    <DashboardLayout>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-6">
        <span>Dashboard</span>
        <ChevronRight className="w-4 h-4" />
        <span className="text-primary font-medium">Reports</span>
      </div>

      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">Reports</h1>
        <p className="text-gray-600">Download and manage your IFRS compliance reports</p>
      </div>

      {/* Empty State */}
      <div className="bg-white rounded-lg p-12 text-center shadow-sm border border-gray-100">
        <FileText className="w-20 h-20 text-gray-300 mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-gray-700 mb-2">No reports yet</h3>
        <p className="text-gray-500 mb-6">
          Complete IFRS calculations to generate downloadable reports
        </p>
      </div>
    </DashboardLayout>
  );
}

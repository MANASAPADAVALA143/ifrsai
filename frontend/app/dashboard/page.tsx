'use client';

import { DashboardLayout } from '@/components/DashboardLayout';
import { KPICard } from '@/components/KPICard';
import { FileText, TrendingUp, Calendar, AlertCircle, Download } from 'lucide-react';
import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from '@/components/Charts';
import { formatIndianCurrency, formatCrores, getGreeting, formatDate } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

// Sample data - in production, fetch from API
const leaseDataTrend = [
  { month: 'Jul', liability: 45.2 },
  { month: 'Aug', liability: 43.8 },
  { month: 'Sep', liability: 42.1 },
  { month: 'Oct', liability: 40.5 },
  { month: 'Nov', liability: 38.9 },
  { month: 'Dec', liability: 37.2 },
];

const leasesByType = [
  { name: 'Office Space', value: 45, color: '#6366F1' },
  { name: 'Equipment', value: 30, color: '#10B981' },
  { name: 'Vehicles', value: 15, color: '#F59E0B' },
  { name: 'Warehouse', value: 10, color: '#EF4444' },
];

const recentCalculations = [
  {
    id: '1',
    date: '2024-02-20',
    leaseName: 'Mumbai Office Lease',
    standard: 'IFRS 16',
    liability: 12453200,
    status: 'Completed',
    fileId: 'file-123',
  },
  {
    id: '2',
    date: '2024-02-19',
    leaseName: 'Delhi Warehouse',
    standard: 'IFRS 16',
    liability: 8675400,
    status: 'Completed',
    fileId: 'file-124',
  },
  {
    id: '3',
    date: '2024-02-18',
    leaseName: 'Software License Revenue',
    standard: 'IFRS 15',
    liability: 15000000,
    status: 'Completed',
    fileId: 'file-125',
  },
];

export default function DashboardPage() {
  const { getCompanyName } = useAuth();

  return (
    <DashboardLayout>
      {/* Greeting */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-primary mb-2">
          {getGreeting()}, {getCompanyName()}
        </h1>
        <p className="text-gray-600 flex items-center gap-2">
          {formatDate(new Date())}
          <span className="flex items-center gap-1 text-success">
            <span>•</span>
            Your compliance is up to date ✓
          </span>
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <KPICard
          title="Total Lease Liability"
          value={formatCrores(372000000)}
          icon={FileText}
          trend={{ value: 2.5, isPositive: false }}
          subtitle="Down from last month"
        />
        <KPICard
          title="Total ROU Assets"
          value={formatCrores(385000000)}
          icon={TrendingUp}
          trend={{ value: 1.2, isPositive: false }}
        />
        <KPICard
          title="Active Leases"
          value="47"
          icon={Calendar}
          subtitle="Across all locations"
        />
        <KPICard
          title="Expiring Soon"
          value="5"
          icon={AlertCircle}
          subtitle="Next 90 days"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Line Chart */}
        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-primary mb-4">Lease Liability Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={leaseDataTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" stroke="#666" style={{ fontSize: '12px' }} />
              <YAxis stroke="#666" style={{ fontSize: '12px' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #ddd',
                  borderRadius: '8px',
                }}
                formatter={(value: any) => [`₹${value}Cr`, 'Liability']}
              />
              <Line
                type="monotone"
                dataKey="liability"
                stroke="#6366F1"
                strokeWidth={3}
                dot={{ fill: '#6366F1', r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Pie Chart */}
        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-primary mb-4">Leases by Asset Type</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={leasesByType}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {leasesByType.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Calculations Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h3 className="text-lg font-bold text-primary">Recent Calculations</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Lease Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Standard
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Liability
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Download
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {recentCalculations.map((calc) => (
                <tr key={calc.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(calc.date)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {calc.leaseName}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-accent/10 text-accent">
                      {calc.standard}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">
                    {formatIndianCurrency(calc.liability)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-success/10 text-success">
                      {calc.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <button className="text-accent hover:text-accent/80 transition-colors">
                      <Download className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}

'use client';

import { useEffect } from 'react';
import { Button } from '@/components/Button';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Dashboard error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="bg-white rounded-[14px] border border-[#e2e8f0] p-8 max-w-md text-center shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <h2 className="text-lg font-semibold text-[#1e293b] mb-2">Something went wrong</h2>
        <p className="text-sm text-[#64748b] mb-4">
          This page failed to load. You can try again or go back to the dashboard.
        </p>
        <div className="flex gap-3 justify-center">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Button variant="secondary" onClick={() => window.location.href = '/dashboard'}>
            Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}

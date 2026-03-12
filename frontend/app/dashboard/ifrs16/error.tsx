'use client';

import { useEffect } from 'react';
import { Button } from '@/components/Button';
import Link from 'next/link';

export default function IFRS16Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('IFRS 16 page error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="bg-white rounded-[14px] border border-[#e2e8f0] p-8 max-w-md text-center shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <h2 className="text-lg font-semibold text-[#1e293b] mb-2">IFRS 16 page error</h2>
        <p className="text-sm text-[#64748b] mb-4">
          This page failed to load. Try again or go back to the overview.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Link href="/dashboard/ifrs16">
            <Button variant="secondary">IFRS 16 overview</Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="secondary">Dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

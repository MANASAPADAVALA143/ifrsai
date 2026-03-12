'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewLeaseRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/ifrs16/leases/new');
  }, [router]);
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <p className="text-[#64748b]">Redirecting to New Lease...</p>
    </div>
  );
}

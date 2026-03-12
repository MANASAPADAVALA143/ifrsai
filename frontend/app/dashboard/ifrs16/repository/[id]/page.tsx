'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function RepositoryLeaseDetailRedirectPage() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : '';
  useEffect(() => {
    if (id) router.replace(`/dashboard/ifrs16/leases/${id}`);
  }, [router, id]);
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <p className="text-[#64748b]">Redirecting to lease...</p>
    </div>
  );
}

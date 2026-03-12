'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBlankEclPortfolio, saveToEclPortfolioRepository } from '@/lib/ecl-portfolio-repository';

export default function NewPortfolioPage() {
  const router = useRouter();

  useEffect(() => {
    const portfolio = createBlankEclPortfolio();
    saveToEclPortfolioRepository(portfolio);
    router.replace(`/dashboard/ifrs9/portfolios/${portfolio.id}`);
  }, [router]);

  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#f97316]"></div>
      <span className="ml-3 text-[#64748b]">Creating new portfolio...</span>
    </div>
  );
}

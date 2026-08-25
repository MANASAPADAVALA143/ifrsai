/**
 * Regression tests for frontend/lib/ifrs16-cfo-insights-calc.ts — the pure
 * calculation helpers behind the CFO Strategic Insights / Quick Analysis
 * feature (Claude-direct fallback path). Mirrors backend/tests/test_ifrs16_cfo_insights.py
 * (the Python-preferred path) so both code paths are covered.
 */
import { describe, it, expect } from 'vitest';
import {
  daysToExpiry,
  buildCashFlowForecast,
  classifyExpiry,
  splitPortfolioPopulations,
  computeHealthScore,
  leaseLiabilityFromRow,
  rouAssetFromRow,
  currentLiabilityFromRow,
  currentRouFromRow,
  type LeaseRow,
} from '../ifrs16-cfo-insights-calc';

const TODAY = '2026-08-25';

function lease(overrides: Partial<LeaseRow> = {}): LeaseRow {
  return {
    id: 'RE-001',
    lease_liability: 1_000_000,
    rou_asset: 1_000_000,
    monthly_payment: 10_000,
    end_date: null,
    escalation_rate: 0,
    ...overrides,
  };
}

describe('daysToExpiry', () => {
  it('computes exact day count — regression for the "7 days reported as 90" bug', () => {
    expect(daysToExpiry('2026-09-01', TODAY)).toBe(7);
  });

  it('is negative for an already-expired lease', () => {
    expect(daysToExpiry('2024-02-29', TODAY)).toBeLessThan(0);
  });

  it('returns null for missing or unparseable end_date, never a false 0', () => {
    expect(daysToExpiry(undefined, TODAY)).toBeNull();
    expect(daysToExpiry('not-a-date', TODAY)).toBeNull();
  });
});

describe('splitPortfolioPopulations — active dashboard consistency', () => {
  it('keeps end_date >= today in active and expired otherwise', () => {
    const rows = [
      { id: 'A', end_date: '2027-01-01', liability: 100 },
      { id: 'B', end_date: '2025-01-01', liability: 50 },
      { id: 'C', end_date: '', liability: 25 },
    ];
    const { portfolioAll, portfolioActive, portfolioExpired } = splitPortfolioPopulations(
      rows,
      TODAY
    );
    expect(portfolioAll).toHaveLength(3);
    expect(portfolioActive.map((r) => r.id)).toEqual(['A']);
    expect(portfolioExpired.map((r) => r.id).sort()).toEqual(['B', 'C']);
  });
});

describe('classifyExpiry — active/expired split and 90-day / 12-month buckets', () => {
  it('excludes the 11 confirmed-expired leases from the bug report', () => {
    const expiredDates = [
      '2024-02-29', '2025-05-31', '2025-06-30', '2025-11-30',
      '2026-01-15', '2026-02-28', '2026-03-31', '2026-04-30',
      '2026-05-31', '2026-05-31', '2026-05-31',
    ];
    const activeDates = ['2027-01-01', '2028-06-15'];
    const mapped = [...expiredDates, ...activeDates].map((end_date, i) => ({
      id: `L-${i}`,
      end_date,
      days_to_expiry: daysToExpiry(end_date, TODAY),
    }));
    const { active, expired } = classifyExpiry(mapped);
    expect(active.length).toBe(2);
    expect(expired.length).toBe(11);
  });

  it('total expiring within 12 months = expiring90 + expiring12mo, matching independent count', () => {
    const within90Days = [6, 10, 45, 89];
    const within365Days = [91, 120, 200, 300, 365];
    const beyond = [400, 800];
    const addDays = (d: number) => {
      const dt = new Date(TODAY);
      dt.setDate(dt.getDate() + d);
      return dt.toISOString().slice(0, 10);
    };
    const allDays = [...within90Days, ...within365Days, ...beyond];
    const mapped = allDays.map((d, i) => {
      const end_date = addDays(d);
      return { id: `L-${i}`, end_date, days_to_expiry: daysToExpiry(end_date, TODAY) };
    });
    const { expiring90, expiring12mo, expiringTotal12mo } = classifyExpiry(mapped);
    expect(expiring90.length).toBe(4);
    expect(expiring12mo.length).toBe(5);
    expect(expiringTotal12mo).toBe(9);
  });
});

describe('leaseLiabilityFromRow / rouAssetFromRow — initial measurement', () => {
  it('reads top-level fields first', () => {
    expect(leaseLiabilityFromRow(lease({ lease_liability: 500_000 }))).toBe(500_000);
    expect(rouAssetFromRow(lease({ rou_asset: 480_000 }))).toBe(480_000);
  });

  it('falls back to nested results when top-level is absent', () => {
    const l = lease({ lease_liability: 0, results: { lease_liability: 250_000 } });
    expect(leaseLiabilityFromRow(l)).toBe(250_000);
  });
});

describe('currentLiabilityFromRow / currentRouFromRow — current carrying value', () => {
  it('falls back to initial measurement and flags the fallback', () => {
    const l = lease({ lease_liability: 1_000_000, rou_asset: 900_000 });
    const result = currentLiabilityFromRow(l);
    expect(result.value).toBe(1_000_000);
    expect(result.isFallback).toBe(true);
  });

  it('prefers the supplied current value over initial measurement — regression for conflating the two', () => {
    const l = lease({
      lease_liability: 1_000_000,
      rou_asset: 900_000,
      current_lease_liability: 650_000,
      current_rou_asset: 580_000,
    });
    const liability = currentLiabilityFromRow(l);
    const rou = currentRouFromRow(l);
    expect(liability.value).toBe(650_000);
    expect(liability.isFallback).toBe(false);
    expect(rou.value).toBe(580_000);
    expect(rou.isFallback).toBe(false);
    expect(liability.value).not.toBe(leaseLiabilityFromRow(l));
  });
});

describe('buildCashFlowForecast — not a flat annual x5 estimate', () => {
  it('declines when a lease expires mid-horizon', () => {
    const shortEnd = new Date(TODAY);
    shortEnd.setDate(shortEnd.getDate() + 180);
    const longEnd = new Date(TODAY);
    longEnd.setDate(longEnd.getDate() + 365 * 10);

    const rows: LeaseRow[] = [
      lease({ id: 'short', monthly_payment: 50_000, end_date: shortEnd.toISOString().slice(0, 10) }),
      lease({ id: 'long', monthly_payment: 20_000, end_date: longEnd.toISOString().slice(0, 10) }),
    ];
    const forecast = buildCashFlowForecast(rows, TODAY);
    expect(forecast.year_1).toBeGreaterThan(forecast.year_2);
    // A flat "annual x5" bug would make every year equal.
    const years = [forecast.year_1, forecast.year_2, forecast.year_3, forecast.year_4, forecast.year_5];
    expect(new Set(years).size).toBeGreaterThan(1);
  });

  it('excludes an already-expired lease entirely', () => {
    const pastEnd = new Date(TODAY);
    pastEnd.setDate(pastEnd.getDate() - 10);
    const rows: LeaseRow[] = [lease({ monthly_payment: 100_000, end_date: pastEnd.toISOString().slice(0, 10) })];
    const forecast = buildCashFlowForecast(rows, TODAY);
    expect(forecast.total_5_year).toBe(0);
  });

  it('applies escalation so later years compound higher (per active month)', () => {
    const longEnd = new Date(TODAY);
    longEnd.setDate(longEnd.getDate() + 365 * 10);
    const rows: LeaseRow[] = [
      lease({ monthly_payment: 10_000, escalation_rate: 5, end_date: longEnd.toISOString().slice(0, 10) }),
    ];
    const forecast = buildCashFlowForecast(rows, TODAY);
    expect(forecast.year_5).toBeGreaterThan(forecast.year_1);
  });
});

describe('computeHealthScore — deterministic and documented', () => {
  it('scores a clean portfolio 100/Excellent with no deductions', () => {
    const result = computeHealthScore({
      activeLeases: Array(10).fill({}),
      totalLeases: 10,
      totalActiveLiability: 1_000_000,
      top5Liability: 150_000, // 15% concentration
      expiring90Count: 0,
      expiring12moCount: 0,
      dataQualityIssueCount: 0,
    });
    expect(result.score).toBe(100);
    expect(result.label).toBe('Excellent');
    expect(result.factors).toEqual([]);
  });

  it('deducts 20 points for >50% concentration', () => {
    const result = computeHealthScore({
      activeLeases: Array(10).fill({}),
      totalLeases: 10,
      totalActiveLiability: 1_000_000,
      top5Liability: 600_000, // 60% concentration
      expiring90Count: 0,
      expiring12moCount: 0,
      dataQualityIssueCount: 0,
    });
    expect(result.score).toBe(80);
    expect(result.factors.find((f) => f.name === 'Concentration risk')?.deduction).toBe(20);
  });

  it('is deterministic — identical inputs always produce identical output', () => {
    const params = {
      activeLeases: Array(36).fill({}),
      totalLeases: 47,
      totalActiveLiability: 400_000_000,
      top5Liability: 150_000_000,
      expiring90Count: 1,
      expiring12moCount: 8,
      dataQualityIssueCount: 2,
    };
    const a = computeHealthScore(params);
    const b = computeHealthScore(params);
    expect(a).toEqual(b);
  });

  it('never goes below 0', () => {
    const result = computeHealthScore({
      activeLeases: Array(10).fill({}),
      totalLeases: 10,
      totalActiveLiability: 1_000_000,
      top5Liability: 1_000_000,
      expiring90Count: 10,
      expiring12moCount: 10,
      dataQualityIssueCount: 10,
      totalAssets: 1_000,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

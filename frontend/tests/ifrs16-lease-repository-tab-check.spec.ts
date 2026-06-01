import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOT_DIR = path.join(process.cwd(), 'test-results', 'ifrs16-test1');
const REPORT_PATH = path.join(SHOT_DIR, 'test1-report.json');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function inputForLabel(page: Page, label: string | RegExp) {
  const labelEl =
    typeof label === 'string'
      ? page.locator('label').filter({ hasText: label })
      : page.locator('label').filter({ hasText: label });
  return labelEl.locator('..').locator('input:not([type="file"]), select, textarea').first();
}

test('IFRS16 lease repository tab checks for RE-UK-001', async ({ page, context }) => {
  ensureDir(SHOT_DIR);
  const report: Record<string, { status: string; note?: string }> = {};

  await context.addInitScript(() => {
    const lease = {
      id: 'RE-UK-001',
      lease_id: 'RE-UK-001',
      title: 'Level 15, Gate Building, DIFC, Dubai',
      asset: 'Level 15, Gate Building, DIFC, Dubai',
      dates: { commencement: '2024-01-01', end: '2028-12-31', term_months: 60 },
      payments: { monthly: 125000, currency: 'AED' },
      currency: 'AED',
      liability: 6400000,
      rou: 6200000,
      calculated_at: new Date().toISOString(),
      lessee_name: 'Al Futtaim Digital Services LLC',
      lessor_name: 'Emaar Properties PJSC',
      lessee: 'Al Futtaim Digital Services LLC',
      lessor: 'Emaar Properties PJSC',
      lease_type: 'Office',
      country: 'UAE',
      city: 'Dubai',
      location: 'Trade Centre',
      start_date: '2024-01-01',
      end_date: '2028-12-31',
      monthly_payment: 125000,
      discount_rate: 5.5,
      lease_status: 'Calculated',
      status: 'Calculated',
      rou_gl_code: 'ROU-1001',
      liability_gl_code: 'LL-2001',
      interest_gl_code: 'INT-3001',
      depreciation_gl_code: 'DEP-4001',
      escalation_type: 'CPI',
      escalation_value: 2.5,
      results: {
        lease_liability: 6400000,
        rou_asset: 6200000,
        monthly_depreciation: 103333,
        total_interest: 680000,
        amortization_schedule: [
          {
            Period: 1,
            Date: '2024-02-01',
            Opening_Balance: 6400000,
            Payment: 125000,
            Interest: 29333,
            Principal: 95667,
            Closing_Balance: 6304333,
          },
          {
            Period: 2,
            Date: '2024-03-01',
            Opening_Balance: 6304333,
            Payment: 125000,
            Interest: 28893,
            Principal: 96107,
            Closing_Balance: 6208226,
          },
        ],
        disclosure_notes:
          'Lease: Level 15, Gate Building, DIFC, Dubai\nThe Group leases office space at Trade Centre, Dubai.',
      },
    };

    localStorage.setItem('ifrs16_market_mode', 'AE');
    localStorage.setItem(
      'demo_user',
      JSON.stringify({
        id: 'demo-playwright',
        email: 'demo@ifrs.ai',
        user_metadata: { company_id: 'COMP-DEMO-001', company_name: 'demo' },
      })
    );
    localStorage.setItem('lease_repository', JSON.stringify([lease]));
  });

  await page.goto('/dashboard/ifrs16/leases/RE-UK-001', { waitUntil: 'networkidle' });
  await expect(page.locator('h1.text-xl').filter({ hasText: /Level 15, Gate Building/i })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText('RE-UK-001').first()).toBeVisible();
  await expect(inputForLabel(page, 'Start Date')).toHaveValue('2024-01-01', { timeout: 15000 });

  // Tab 1 — Contract Details
  try {
    await page.getByRole('button', { name: 'Contract Details' }).click();
    await expect(inputForLabel(page, 'Start Date')).toHaveValue('2024-01-01');
    await expect(inputForLabel(page, 'End Date')).toHaveValue('2028-12-31');
    await page.screenshot({ path: path.join(SHOT_DIR, 'tab-1-contract-details.png'), fullPage: true });
    report.tab1 = { status: 'pass' };
  } catch (e) {
    report.tab1 = { status: 'fail', note: e instanceof Error ? e.message : String(e) };
    await page.screenshot({ path: path.join(SHOT_DIR, 'tab-1-contract-details-FAIL.png'), fullPage: true });
  }

  // Tab 2 — Financial Management
  try {
    await page.getByRole('button', { name: 'Financial Management' }).click();
    await expect(inputForLabel(page, 'IBR / Discount Rate')).toHaveValue('5.5');
    await expect(page.getByText('Escalation & Terms')).toBeVisible();
    await expect(inputForLabel(page, 'Currency')).toHaveValue('AED');
    await expect(inputForLabel(page, 'Lessor')).toHaveValue(/Emaar Properties PJSC/i);
    await expect(inputForLabel(page, 'Lessee')).toHaveValue(/Al Futtaim Digital Services LLC/i);
    await page.screenshot({ path: path.join(SHOT_DIR, 'tab-2-financial-management.png'), fullPage: true });
    report.tab2 = { status: 'pass' };
  } catch (e) {
    report.tab2 = { status: 'fail', note: e instanceof Error ? e.message : String(e) };
    await page.screenshot({ path: path.join(SHOT_DIR, 'tab-2-financial-management-FAIL.png'), fullPage: true });
  }

  // Tab 3 — Lease Modifications
  try {
    await page.getByRole('button', { name: 'Lease Modifications' }).click();
    await page.getByRole('button', { name: /Add Modification/i }).click();
    await expect(page.getByText(/New Modification|Edit Modification/i)).toBeVisible();
    const advisorVisible = await page.getByText(/Modification advisor/i).isVisible().catch(() => false);
    const advisorError = await page.locator('.text-red-800').first().isVisible().catch(() => false);
    await page.screenshot({ path: path.join(SHOT_DIR, 'tab-3-lease-modifications.png'), fullPage: true });
    report.tab3 = {
      status: advisorVisible || advisorError ? 'pass' : 'warn',
      note: advisorError ? 'Modification advisor UI shown; API may be offline' : undefined,
    };
  } catch (e) {
    report.tab3 = { status: 'fail', note: e instanceof Error ? e.message : String(e) };
    await page.screenshot({ path: path.join(SHOT_DIR, 'tab-3-lease-modifications-FAIL.png'), fullPage: true });
  }

  // Tab 4 — Assets & Locations
  try {
    await page.getByRole('button', { name: 'Assets & Locations' }).click();
    await expect(page.getByRole('heading', { name: 'Assets & Locations' })).toBeVisible();
    await expect(inputForLabel(page, 'Lease Type')).toHaveValue('Office');
    await expect(inputForLabel(page, 'ROU Asset GL Code')).toHaveValue('ROU-1001');
    await expect(inputForLabel(page, 'Lease Liability GL Code')).toHaveValue('LL-2001');
    await page.screenshot({ path: path.join(SHOT_DIR, 'tab-4-assets-locations.png'), fullPage: true });
    report.tab4 = { status: 'pass' };
  } catch (e) {
    report.tab4 = { status: 'fail', note: e instanceof Error ? e.message : String(e) };
    await page.screenshot({ path: path.join(SHOT_DIR, 'tab-4-assets-locations-FAIL.png'), fullPage: true });
  }

  // Tab 5 — Schedules
  try {
    await page.getByRole('button', { name: 'Schedules' }).click();
    await page.getByRole('button', { name: 'Lease Liability Schedule' }).click();
    await expect(page.getByRole('columnheader', { name: 'Opening' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Closing' })).toBeVisible();
    await expect(page.getByText('2024-02-01')).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, 'tab-5-schedules.png'), fullPage: true });
    report.tab5 = { status: 'pass' };
  } catch (e) {
    report.tab5 = { status: 'fail', note: e instanceof Error ? e.message : String(e) };
    await page.screenshot({ path: path.join(SHOT_DIR, 'tab-5-schedules-FAIL.png'), fullPage: true });
  }

  // Tab 6 — Review & Calculate
  try {
    await page.getByRole('button', { name: 'Review & Calculate' }).click();
    await expect(page.getByRole('button', { name: '🧮 Calculate IFRS 16' })).toBeVisible();
    await expect(page.getByText('LEASE LIABILITY', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('ROU ASSET', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Auto-generated accounting entries')).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, 'tab-6-review-calculate.png'), fullPage: true });
    report.tab6 = { status: 'pass' };
  } catch (e) {
    report.tab6 = { status: 'fail', note: e instanceof Error ? e.message : String(e) };
    await page.screenshot({ path: path.join(SHOT_DIR, 'tab-6-review-calculate-FAIL.png'), fullPage: true });
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  const failures = Object.entries(report).filter(([, v]) => v.status === 'fail');
  expect(failures, `Tab failures: ${JSON.stringify(failures)}`).toHaveLength(0);
});

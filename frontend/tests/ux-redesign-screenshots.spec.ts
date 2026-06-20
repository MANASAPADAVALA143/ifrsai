import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOT_DIR = path.join(process.cwd(), 'test-results', 'ux-redesign-verify');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function seedDemoSession(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('ifrs16_market_mode', 'AE');
    localStorage.setItem(
      'demo_user',
      JSON.stringify({
        id: 'demo-playwright',
        email: 'demo@ifrs.ai',
        user_metadata: { company_id: 'COMP-DEMO-001', company_name: 'Emaar Development LLC' },
      })
    );
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
      status: 'Calculated',
      results: { lease_liability: 6400000, rou_asset: 6200000 },
    };
    localStorage.setItem('lease_repository', JSON.stringify([lease]));
  });
}

async function waitForDashboard(page: Page) {
  await expect(page.getByText('Redirecting to login...')).toHaveCount(0, { timeout: 20000 });
}

test.describe('UX redesign verification screenshots', () => {
  test.beforeEach(async ({ page }) => {
    ensureDir(SHOT_DIR);
    await seedDemoSession(page);
  });

  test('IFRS 15 — sidebar, KPI bar, stepper', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard/ifrs15', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await waitForDashboard(page);
    await expect(page.getByText('CONTRACTS').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Total Contract Value').first()).toBeVisible();
    await expect(page.getByText('Contract Details').first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, 'ifrs15-revenue-calculate.png'), fullPage: true });

    await page.getByRole('button', { name: 'Real Estate UAE' }).click();
    await page.waitForURL('**/ifrs15/realestate**', { timeout: 15000 });
    await page.screenshot({ path: path.join(SHOT_DIR, 'ifrs15-realestate-uae.png'), fullPage: true });
  });

  test('IFRS 16 — sidebar and repository', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard/ifrs16/repository', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await waitForDashboard(page);
    await expect(page.getByText('LEASES').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Total Lease Liability').first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, 'ifrs16-repository.png'), fullPage: true });
  });

  test('IFRS 9 — sidebar and calculate ECL', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard/ifrs9', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await waitForDashboard(page);
    await expect(page.getByText('PORTFOLIOS').first()).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: path.join(SHOT_DIR, 'ifrs9-overview.png'), fullPage: true });

    await page.getByRole('button', { name: 'Calculate ECL' }).click();
    await expect(page.getByText('Calculation results')).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: path.join(SHOT_DIR, 'ifrs9-calculate-ecl.png'), fullPage: true });
  });

  test('Mobile hamburger — IFRS 15 sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard/ifrs15', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await waitForDashboard(page);
    const menuBtn = page.getByRole('button', { name: 'IFRS 15 Menu' });
    await expect(menuBtn).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: path.join(SHOT_DIR, 'ifrs15-mobile-collapsed.png'), fullPage: true });
    await menuBtn.click();
    await expect(page.getByText('CONTRACTS').first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, 'ifrs15-mobile-menu-open.png'), fullPage: true });
  });
});

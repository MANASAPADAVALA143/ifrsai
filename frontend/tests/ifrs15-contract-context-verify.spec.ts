import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SHOT_DIR = path.join(process.cwd(), 'test-results', 'ifrs15-context-verify');
const PDF_PATH = path.resolve(
  process.cwd(),
  '..',
  'test_fixtures',
  'Contract_FinancingComponent_LandSale.pdf',
);

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function ensureLoggedIn(page: Page) {
  const email = process.env.PLAYWRIGHT_TEST_EMAIL || `pw-verify-${Date.now()}@ifrs.ai`;
  const password = process.env.PLAYWRIGHT_TEST_PASSWORD || 'TestVerify123!';

  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#firmCode').fill('emaar-dev');
  await page.getByRole('button', { name: 'Sign up' }).click();

  const signedUp = await page
    .waitForURL('**/dashboard/**', { timeout: 20000 })
    .then(() => true)
    .catch(() => false);

  if (!signedUp) {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL('**/dashboard/**', { timeout: 30000 });
  }
}

test.describe('IFRS 15 shared contract context — financing PDF', () => {
  test.beforeEach(async () => {
    ensureDir(SHOT_DIR);
    test.skip(!fs.existsSync(PDF_PATH), `Missing test PDF at ${PDF_PATH}`);
  });

  test('session flow: upload → financing pre-fill → PV → context persists → master report', async ({
    page,
  }) => {
    test.setTimeout(600000);
    await ensureLoggedIn(page);
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Step 1 — Upload PDF → Revenue Calculate
    await page.goto('/dashboard/ifrs15', { waitUntil: 'domcontentloaded', timeout: 180000 });
    await expect(page.getByText('IFRS 15', { exact: false }).first()).toBeVisible({ timeout: 60000 });

    await page.locator('input[type="file"]').first().setInputFiles(PDF_PATH);
    await expect(page.getByText('Calculation completed!')).toBeVisible({ timeout: 300000 });

    await expect(page.getByText('LAND-2025-DEFER-005').first()).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '01-revenue-calculate.png'), fullPage: true });

    // Step 2 — Financing Component tab + context bar pre-fill
    await page.getByRole('button', { name: 'Financing Component' }).click();
    await expect(page.getByText('SIGNIFICANT FINANCING COMPONENT')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Load from current contract')).toBeVisible();
    await expect(page.getByText('LAND-2025-DEFER-005')).toBeVisible();

    const fcCard = page.locator('.border.border-border-default.rounded-lg.p-4').first();
    await expect(fcCard.locator('input[placeholder="Contract ID"]')).toHaveValue('LAND-2025-DEFER-005');

    const contractValue = fcCard.getByLabel('Contract value ($)');
    await expect(contractValue).not.toHaveValue('');
    const valueNum = Number((await contractValue.inputValue()).replace(/,/g, ''));
    expect(valueNum).toBeGreaterThan(4_000_000);

    await page.screenshot({ path: path.join(SHOT_DIR, '02-financing-context-prefill.png'), fullPage: true });

    // Step 3 — Payment date, discount rate, run assessment
    await fcCard.getByLabel('Payment date (cash)').fill('2028-04-01');
    await fcCard.getByLabel('Discount rate (%)').fill('7');
    await page.getByRole('button', { name: 'Calculate', exact: true }).click();
    await expect(page.getByText(/4[,\s]?081[,\s]?/)).toBeVisible({ timeout: 60000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '03-financing-pv-result.png'), fullPage: true });

    // Step 4 — Context bar persists on other tabs
    await page.getByRole('button', { name: 'Contract Costs' }).click();
    await expect(page.getByText('Load from current contract')).toBeVisible();
    await expect(page.getByText('LAND-2025-DEFER-005')).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '04-contract-costs-context.png'), fullPage: true });

    await page.getByRole('button', { name: 'TP Adjustments' }).click();
    await expect(page.getByText('LAND-2025-DEFER-005')).toBeVisible();
    await page.screenshot({ path: path.join(SHOT_DIR, '05-tp-adjustments-context.png'), fullPage: true });

    // Step 5 — Master Report
    await page.getByRole('button', { name: 'Master Report & Excel' }).click();
    await expect(page.getByText('Master Report', { exact: false })).toBeVisible({ timeout: 120000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '06-master-report.png'), fullPage: true });
  });
});

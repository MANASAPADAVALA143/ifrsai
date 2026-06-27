# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ifrs15-contract-context-verify.spec.ts >> IFRS 15 shared contract context — financing PDF >> session flow: upload → financing pre-fill → PV → context persists → master report
- Location: tests\ifrs15-contract-context-verify.spec.ts:47:7

# Error details

```
TimeoutError: page.waitForURL: Timeout 30000ms exceeded.
=========================== logs ===========================
waiting for navigation to "**/dashboard/**" until "load"
  navigated to "http://127.0.0.1:3004/login"
============================================================
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e4]:
      - link "IFRS.ai" [ref=e6] [cursor=pointer]:
        - /url: /
        - generic [ref=e7]: IFRS.ai
      - generic [ref=e8]:
        - heading "Welcome back" [level=1] [ref=e9]
        - paragraph [ref=e10]: Sign in to your account to continue
      - generic [ref=e11]:
        - generic [ref=e12]:
          - generic [ref=e13]: Email address
          - textbox "Email address" [ref=e14]:
            - /placeholder: you@company.com
        - generic [ref=e15]:
          - generic [ref=e16]: Password
          - textbox "Password" [ref=e17]:
            - /placeholder: ΓÇóΓÇóΓÇóΓÇóΓÇóΓÇóΓÇóΓÇó
        - button "Sign In" [ref=e18] [cursor=pointer]
      - paragraph [ref=e20]:
        - text: Don't have an account?
        - link "Sign up with company code" [ref=e21] [cursor=pointer]:
          - /url: /signup
      - paragraph [ref=e23]:
        - strong [ref=e24]: "Demo Note:"
        - text: For testing, you can use any email/password combination. In production, this will use Supabase authentication.
    - link "ΓåÉ Back to home" [ref=e26] [cursor=pointer]:
      - /url: /
  - button "Open Next.js Dev Tools" [ref=e32] [cursor=pointer]:
    - img [ref=e33]
  - alert [ref=e36]
```

# Test source

```ts
  1   | import { test, expect, type Page } from '@playwright/test';
  2   | import fs from 'node:fs';
  3   | import path from 'node:path';
  4   | 
  5   | const SHOT_DIR = path.join(process.cwd(), 'test-results', 'ifrs15-context-verify');
  6   | const PDF_PATH = path.resolve(
  7   |   process.cwd(),
  8   |   '..',
  9   |   'test_fixtures',
  10  |   'Contract_FinancingComponent_LandSale.pdf',
  11  | );
  12  | 
  13  | function ensureDir(dir: string) {
  14  |   if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  15  | }
  16  | 
  17  | async function ensureLoggedIn(page: Page) {
  18  |   const email = process.env.PLAYWRIGHT_TEST_EMAIL || `pw-verify-${Date.now()}@ifrs.ai`;
  19  |   const password = process.env.PLAYWRIGHT_TEST_PASSWORD || 'TestVerify123!';
  20  | 
  21  |   await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  22  |   await page.locator('#email').fill(email);
  23  |   await page.locator('#password').fill(password);
  24  |   await page.locator('#firmCode').fill('emaar-dev');
  25  |   await page.getByRole('button', { name: 'Sign up' }).click();
  26  | 
  27  |   const signedUp = await page
  28  |     .waitForURL('**/dashboard/**', { timeout: 20000 })
  29  |     .then(() => true)
  30  |     .catch(() => false);
  31  | 
  32  |   if (!signedUp) {
  33  |     await page.goto('/login', { waitUntil: 'domcontentloaded' });
  34  |     await page.locator('#email').fill(email);
  35  |     await page.locator('#password').fill(password);
  36  |     await page.getByRole('button', { name: 'Sign In' }).click();
> 37  |     await page.waitForURL('**/dashboard/**', { timeout: 30000 });
      |                ^ TimeoutError: page.waitForURL: Timeout 30000ms exceeded.
  38  |   }
  39  | }
  40  | 
  41  | test.describe('IFRS 15 shared contract context — financing PDF', () => {
  42  |   test.beforeEach(async () => {
  43  |     ensureDir(SHOT_DIR);
  44  |     test.skip(!fs.existsSync(PDF_PATH), `Missing test PDF at ${PDF_PATH}`);
  45  |   });
  46  | 
  47  |   test('session flow: upload → financing pre-fill → PV → context persists → master report', async ({
  48  |     page,
  49  |   }) => {
  50  |     test.setTimeout(600000);
  51  |     await ensureLoggedIn(page);
  52  |     await page.setViewportSize({ width: 1440, height: 1000 });
  53  | 
  54  |     // Step 1 — Upload PDF → Revenue Calculate
  55  |     await page.goto('/dashboard/ifrs15', { waitUntil: 'domcontentloaded', timeout: 180000 });
  56  |     await expect(page.getByText('IFRS 15', { exact: false }).first()).toBeVisible({ timeout: 60000 });
  57  | 
  58  |     await page.locator('input[type="file"]').first().setInputFiles(PDF_PATH);
  59  |     await expect(page.getByText('Calculation completed!')).toBeVisible({ timeout: 300000 });
  60  | 
  61  |     await expect(page.getByText('LAND-2025-DEFER-005').first()).toBeVisible({ timeout: 30000 });
  62  |     await page.screenshot({ path: path.join(SHOT_DIR, '01-revenue-calculate.png'), fullPage: true });
  63  | 
  64  |     // Step 2 — Financing Component tab + context bar pre-fill
  65  |     await page.getByRole('button', { name: 'Financing Component' }).click();
  66  |     await expect(page.getByText('SIGNIFICANT FINANCING COMPONENT')).toBeVisible({ timeout: 30000 });
  67  |     await expect(page.getByText('Load from current contract')).toBeVisible();
  68  |     await expect(page.getByText('LAND-2025-DEFER-005')).toBeVisible();
  69  | 
  70  |     const fcCard = page.locator('.border.border-border-default.rounded-lg.p-4').first();
  71  |     await expect(fcCard.locator('input[placeholder="Contract ID"]')).toHaveValue('LAND-2025-DEFER-005');
  72  | 
  73  |     const contractValue = fcCard.getByLabel('Contract value ($)');
  74  |     await expect(contractValue).not.toHaveValue('');
  75  |     const valueNum = Number((await contractValue.inputValue()).replace(/,/g, ''));
  76  |     expect(valueNum).toBeGreaterThan(4_000_000);
  77  | 
  78  |     await page.screenshot({ path: path.join(SHOT_DIR, '02-financing-context-prefill.png'), fullPage: true });
  79  | 
  80  |     // Step 3 — Payment date, discount rate, run assessment
  81  |     await fcCard.getByLabel('Payment date (cash)').fill('2028-04-01');
  82  |     await fcCard.getByLabel('Discount rate (%)').fill('7');
  83  |     await page.getByRole('button', { name: 'Calculate', exact: true }).click();
  84  |     await expect(page.getByText(/4[,\s]?081[,\s]?/)).toBeVisible({ timeout: 60000 });
  85  |     await page.screenshot({ path: path.join(SHOT_DIR, '03-financing-pv-result.png'), fullPage: true });
  86  | 
  87  |     // Step 4 — Context bar persists on other tabs
  88  |     await page.getByRole('button', { name: 'Contract Costs' }).click();
  89  |     await expect(page.getByText('Load from current contract')).toBeVisible();
  90  |     await expect(page.getByText('LAND-2025-DEFER-005')).toBeVisible();
  91  |     await page.screenshot({ path: path.join(SHOT_DIR, '04-contract-costs-context.png'), fullPage: true });
  92  | 
  93  |     await page.getByRole('button', { name: 'TP Adjustments' }).click();
  94  |     await expect(page.getByText('LAND-2025-DEFER-005')).toBeVisible();
  95  |     await page.screenshot({ path: path.join(SHOT_DIR, '05-tp-adjustments-context.png'), fullPage: true });
  96  | 
  97  |     // Step 5 — Master Report
  98  |     await page.getByRole('button', { name: 'Master Report & Excel' }).click();
  99  |     await expect(page.getByText('Master Report', { exact: false })).toBeVisible({ timeout: 120000 });
  100 |     await page.screenshot({ path: path.join(SHOT_DIR, '06-master-report.png'), fullPage: true });
  101 |   });
  102 | });
  103 | 
```
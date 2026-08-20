import { expect, test } from '@playwright/test';

/**
 * Runs against VITE_DATA_MODE=demo (see playwright.config.ts) so these
 * don't depend on a live API or Microsoft Entra tenant — they verify the
 * app shell, routing, and RBAC-driven navigation render correctly.
 */
test.describe('Essential web flows (demo mode)', () => {
  test('sign-in page renders the Green Wells identity and a Microsoft sign-in action', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('GREEN WELLS ENERGIES')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with microsoft/i })).toBeVisible();
  });

  test('an authenticated demo session lands on the dashboard with role-appropriate navigation', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Dashboard')).toBeVisible();
    // Admin (the seeded demo user) should see Users but the sidebar should
    // never show a "no access" message for any item it does render.
    await expect(page.getByRole('button', { name: 'Users' })).toBeVisible();
    await expect(page.getByText(/you do not have access/i)).toHaveCount(0);
  });

  test('customers directory is reachable and the import wizard starts at step 1', async ({ page }) => {
    await page.goto('/customers/import');
    await expect(page.getByText('Upload file')).toBeVisible();
    await expect(page.getByText('Drop an Excel file here, or choose one')).toBeVisible();
  });

  test('special rate requests page shows the Chairman-only approval framing', async ({ page }) => {
    await page.goto('/special-rates');
    await expect(page.getByText('Only the Chairman can approve or reject a request')).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';
async function create(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a query handle' }).click();
  await expect(page.locator('#status')).toHaveText('ready');
}
test('students retain one handle across two turns, inspect usage, and close once', async ({
  page,
}) => {
  await create(page);
  const id = await page.locator('#handle-id').textContent();
  for (let i = 1; i <= 2; i++) {
    await page.getByRole('button', { name: 'Send a turn', exact: true }).click();
    await expect(page.locator('#turns')).toHaveText(String(i));
    await expect(page.locator('#status')).toHaveText('ready');
    await expect(page.locator('#closes')).toHaveText('0');
    await expect(page.locator('#handle-id')).toHaveText(id!);
  }
  await expect(page.locator('#cost')).toHaveText('$0.0020');
  await page.getByRole('button', { name: 'Result usage', exact: true }).click();
  await expect(page.locator('#events')).toContainText('Latest result usage');
  await page.getByRole('button', { name: 'Close the session', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('closed');
  await expect(page.locator('#closes')).toHaveText('1');
  await expect(page.locator('#send')).toBeDisabled();
});
test('runtime controls expose discovery, MCP changes and next-response model changes', async ({
  page,
}) => {
  await create(page);
  await page.getByRole('button', { name: 'Available agents', exact: true }).click();
  await expect(page.locator('#events')).toContainText('supportedAgents()');
  await page.locator('#runtime-controls summary').click();
  await page.getByRole('button', { name: 'Attach course MCP' }).click();
  await expect(page.locator('#events')).toContainText('setMcpServers()');
  await page.getByRole('button', { name: 'MCP status', exact: true }).click();
  await expect(page.locator('#events')).toContainText('Connection health is separate');
  await page.locator('#model').fill('student-model');
  await page.getByRole('button', { name: 'Apply model' }).click();
  await expect(page.locator('#model-current')).toContainText('student-model');
  await page.getByRole('button', { name: 'Context usage', exact: true }).click();
  await expect(page.locator('#events')).toContainText('getContextUsage()');
});
test('closing an active turn stops updates; a replacement starts fresh', async ({ page }) => {
  await create(page);
  await page.getByRole('button', { name: 'Send a turn', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('running');
  await page.getByRole('button', { name: 'Close the session', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('closed');
  await expect(page.locator('#closes')).toHaveText('1');
  await page.getByRole('button', { name: 'Create a query handle' }).click();
  await expect(page.locator('#status')).toHaveText('ready');
  await expect(page.locator('#turns')).toHaveText('0');
  await expect(page.locator('#closes')).toHaveText('0');
});
test('practice exports explicitly identify fixture data', async ({ page }) => {
  await create(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export trace' }).click();
  expect((await download).suggestedFilename()).toBe('lesson-03-query-lifecycle.json');
  await expect(page.locator('#mode-explanation')).toContainText('teaching fixtures');
});
test('runtime guide includes the version correction and keyboard tab navigation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Control room/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#guide')).toBeVisible();
  await expect(page.locator('#usage-correction')).toContainText('no getUsage()');
  await expect(page.locator('.method-card')).toHaveCount(10);
});
test('quiz checks lifecycle and cumulative usage concepts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /Check your understanding/ }).click();
  for (const [i, choice] of [0, 1, 2, 1].entries())
    await page.locator(`input[name="q${i}"][value="${choice}"]`).check();
  await page.getByRole('button', { name: 'Check my answers' }).click();
  await expect(page.locator('#quiz-score')).toContainText('4 / 4 correct');
});
test('phone layout fits all panels without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await create(page);
  for (const tab of [/Control room/, /Runtime guide/, /Check your understanding/]) {
    await page.getByRole('tab', { name: tab }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
test('model and prompt validation show errors without replacing the handle', async ({ page }) => {
  await create(page);
  await page.locator('#prompt').fill('short');
  await page.locator('#send').click();
  await expect(page.locator('#notice')).toContainText('10 and 2,000');
  await expect(page.locator('#status')).toHaveText('ready');
});

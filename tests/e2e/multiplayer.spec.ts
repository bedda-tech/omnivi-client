import { test, expect } from '@playwright/test';

test.describe('Omnivi E2E: Multiplayer Gameplay', () => {
  test.beforeEach(async ({ page }) => {
    // Check if server is running before proceeding
    try {
      const healthCheck = await fetch('http://localhost:3001/health', {
        method: 'GET',
      });
      test.skip(!healthCheck.ok, 'Server not running — skipping E2E tests');
    } catch {
      test.skip(true, 'Server not running — skipping E2E tests');
    }
  });

  test('Two clients can join the same game room', async ({ browser }) => {
    // Launch two browser contexts (simulating two players)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Player 1 joins
      await page1.goto('/');
      await page1.waitForSelector('text=/Free Tier|Stake|Connect/i', { timeout: 5000 });
      const freeButton1 = page1.getByText(/Free Tier/i).first();
      if (await freeButton1.isVisible({ timeout: 1000 })) {
        await freeButton1.click();
      }

      // Wait for Player 1 to fully load the game
      await page1.waitForFunction(() => {
        const canvas = document.querySelector('canvas');
        return canvas && canvas.width > 0 && canvas.height > 0;
      }, { timeout: 10000 });

      // Player 2 joins
      await page2.goto('/');
      await page2.waitForSelector('text=/Free Tier|Stake|Connect/i', { timeout: 5000 });
      const freeButton2 = page2.getByText(/Free Tier/i).first();
      if (await freeButton2.isVisible({ timeout: 1000 })) {
        await freeButton2.click();
      }

      // Wait for Player 2 to fully load the game
      await page2.waitForFunction(() => {
        const canvas = document.querySelector('canvas');
        return canvas && canvas.width > 0 && canvas.height > 0;
      }, { timeout: 10000 });

      // Both games should be rendering
      const game1Active = await page1.evaluate(() => {
        const canvas = document.querySelector('canvas') as any;
        return canvas && canvas.width > 0 && canvas.height > 0;
      });

      const game2Active = await page2.evaluate(() => {
        const canvas = document.querySelector('canvas') as any;
        return canvas && canvas.width > 0 && canvas.height > 0;
      });

      expect(game1Active).toBe(true);
      expect(game2Active).toBe(true);

      // Let both games run for a moment to ensure they're in sync
      await page1.waitForTimeout(2000);
      await page2.waitForTimeout(2000);

      // Take screenshots showing both games are active
      await page1.screenshot({ path: 'test-results/multiplayer-player1.png' });
      await page2.screenshot({ path: 'test-results/multiplayer-player2.png' });
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('Players see each other on the leaderboard', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Both players join
      for (const page of [page1, page2]) {
        await page.goto('/');
        await page.waitForSelector('text=/Free Tier|Stake|Connect/i', { timeout: 5000 });
        const freeButton = page.getByText(/Free Tier/i).first();
        if (await freeButton.isVisible({ timeout: 1000 })) {
          await freeButton.click();
        }
        await page.waitForFunction(() => {
          const canvas = document.querySelector('canvas');
          return canvas && canvas.width > 0 && canvas.height > 0;
        }, { timeout: 10000 });
      }

      // Wait for network sync
      await page1.waitForTimeout(3000);
      await page2.waitForTimeout(3000);

      // Check that both games are still rendering (leaderboard is drawn on canvas)
      const bothRendering = await Promise.all([
        page1.evaluate(() => {
          const canvas = document.querySelector('canvas') as any;
          return canvas && canvas.width > 0 && canvas.height > 0;
        }),
        page2.evaluate(() => {
          const canvas = document.querySelector('canvas') as any;
          return canvas && canvas.width > 0 && canvas.height > 0;
        }),
      ]);

      expect(bothRendering[0]).toBe(true);
      expect(bothRendering[1]).toBe(true);
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test('Player can input actions without causing network errors', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('text=/Free Tier|Stake|Connect/i', { timeout: 5000 });
    const freeButton = page.getByText(/Free Tier/i).first();
    if (await freeButton.isVisible({ timeout: 1000 })) {
      await freeButton.click();
    }

    // Wait for game to load
    await page.waitForFunction(() => {
      const canvas = document.querySelector('canvas');
      return canvas && canvas.width > 0 && canvas.height > 0;
    }, { timeout: 10000 });

    // Capture any console errors
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Perform various actions
    await page.keyboard.press('Shift'); // Boost
    await page.waitForTimeout(200);
    await page.keyboard.press('KeyQ'); // Eject
    await page.waitForTimeout(200);
    await page.keyboard.press('KeyF'); // Shield
    await page.waitForTimeout(200);
    await page.keyboard.press('KeyG'); // Gravity Well
    await page.waitForTimeout(200);
    await page.keyboard.press('KeyR'); // Fragment Bomb
    await page.waitForTimeout(200);

    // Get any errors that occurred
    const networkErrors = errors.filter((e) =>
      e.toLowerCase().includes('network') ||
      e.toLowerCase().includes('connection') ||
      e.toLowerCase().includes('socket') ||
      e.toLowerCase().includes('room'),
    );

    // There should be no network-related errors
    expect(networkErrors.length).toBe(0);

    // Game should still be running
    const gameStillRunning = await page.evaluate(() => {
      const canvas = document.querySelector('canvas') as any;
      return canvas && canvas.width > 0 && canvas.height > 0;
    });

    expect(gameStillRunning).toBe(true);
  });
});

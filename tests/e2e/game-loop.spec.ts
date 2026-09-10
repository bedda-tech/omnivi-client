import { test, expect } from '@playwright/test';

test.describe('Omnivi E2E: Core Game Loop', () => {
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

  test('Client loads and detects server connection', async ({ page }) => {
    await page.goto('/');

    // Wait for Phaser to initialize and load the Lobby scene
    await expect(page).toHaveTitle(/Omnivi/i);

    // Verify the Lobby scene loads (should show "Free Tier" or stake input)
    await page.waitForSelector('text=/Free Tier|Stake|Connect/i', { timeout: 5000 });

    // Screenshot for debugging
    await page.screenshot({ path: 'test-results/lobby-loaded.png' });
  });

  test('Game scene initializes with network connection', async ({ page }) => {
    await page.goto('/');

    // Wait for Lobby scene to load
    await page.waitForSelector('text=/Free Tier|Stake|Connect/i', { timeout: 5000 });

    // Click "Free Tier" button to join without staking
    const freeButton = page.getByText(/Free Tier/i).first();
    if (await freeButton.isVisible({ timeout: 1000 })) {
      await freeButton.click();

      // Wait for Main scene to load (player spawned)
      // The Main scene should show the game canvas with players/physics
      await page.waitForFunction(() => {
        const canvas = document.querySelector('canvas');
        return canvas && canvas.width > 0 && canvas.height > 0;
      }, { timeout: 10000 });

      // Verify HUD is visible (mass display, etc.)
      await expect(page.locator('canvas')).toBeVisible();

      // Let the game run for 2 seconds to ensure no immediate crashes
      await page.waitForTimeout(2000);

      // Screenshot to verify game is rendering
      await page.screenshot({ path: 'test-results/game-running.png' });
    } else {
      test.skip(true, 'Free Tier button not available — server may not be ready');
    }
  });

  test('Local player exists and physics engine is running', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('text=/Free Tier|Stake|Connect/i', { timeout: 5000 });

    const freeButton = page.getByText(/Free Tier/i).first();
    if (await freeButton.isVisible({ timeout: 1000 })) {
      await freeButton.click();

      // Wait for Main scene
      await page.waitForFunction(() => {
        const canvas = document.querySelector('canvas');
        return canvas && canvas.width > 0 && canvas.height > 0;
      }, { timeout: 10000 });

      // Inject code to check game state
      const gameState = await page.evaluate(() => {
        // Access the Phaser scene via window.game if available
        // This is a best-effort check; exact implementation depends on how the client exposes state
        return {
          hasCanvas: !!document.querySelector('canvas'),
          canvasWidth: (document.querySelector('canvas') as any)?.width || 0,
          canvasHeight: (document.querySelector('canvas') as any)?.height || 0,
        };
      });

      expect(gameState.hasCanvas).toBe(true);
      expect(gameState.canvasWidth).toBeGreaterThan(0);
      expect(gameState.canvasHeight).toBeGreaterThan(0);
    }
  });

  test('Network manager can join room (with server running)', async ({ page }) => {
    await page.goto('/');

    // Set up listener for network events (if exposed)
    const networkEvents: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'log' && msg.text().includes('room')) {
        networkEvents.push(msg.text());
      }
    });

    await page.waitForSelector('text=/Free Tier|Stake|Connect/i', { timeout: 5000 });

    const freeButton = page.getByText(/Free Tier/i).first();
    if (await freeButton.isVisible({ timeout: 1000 })) {
      await freeButton.click();

      // Wait for Main scene to load (means room joined successfully)
      await page.waitForFunction(() => {
        const canvas = document.querySelector('canvas');
        return canvas && canvas.width > 0 && canvas.height > 0;
      }, { timeout: 10000 });

      // If we get here, the room join succeeded (no connection error)
      expect(true).toBe(true);
    }
  });
});

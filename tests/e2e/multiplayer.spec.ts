import { test, expect } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import {
  SERVER_HTTP,
  bootClient,
  collectErrors,
  enterGame,
  serverIsUp,
  snapshot,
  waitForSnapshot,
} from './harness';

/** Open a second, independent player in its own browser context. */
async function openPlayer(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

test.describe('Omnivi E2E: Multiplayer Gameplay', () => {
  let serverUp = false;

  test.beforeAll(async () => {
    serverUp = await serverIsUp();
  });

  test.beforeEach(() => {
    test.skip(!serverUp, `No game server at ${SERVER_HTTP} — start omnivi-server`);
  });

  test('two clients join the same room and see each other', async ({ browser }) => {
    const a = await openPlayer(browser);
    const b = await openPlayer(browser);

    try {
      for (const p of [a, b]) {
        await bootClient(p.page);
        await enterGame(p.page);
      }

      const sa = await waitForSnapshot(a.page, 's.net && s.net.connected && s.net.sessionId');
      const sb = await waitForSnapshot(b.page, 's.net && s.net.connected && s.net.sessionId');

      // Distinct seats…
      expect(sa.net!.sessionId).not.toBe(sb.net!.sessionId);

      // …in the same room, which is only observable as each seeing one peer.
      const withPeerA = await waitForSnapshot(a.page, 's.net && s.net.otherPlayers >= 1');
      const withPeerB = await waitForSnapshot(b.page, 's.net && s.net.otherPlayers >= 1');
      expect(withPeerA.net!.otherPlayers).toBeGreaterThanOrEqual(1);
      expect(withPeerB.net!.otherPlayers).toBeGreaterThanOrEqual(1);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('a peer leaving is removed from the remaining client', async ({ browser }) => {
    const a = await openPlayer(browser);
    const b = await openPlayer(browser);
    let bClosed = false;

    try {
      for (const p of [a, b]) {
        await bootClient(p.page);
        await enterGame(p.page);
      }
      await waitForSnapshot(a.page, 's.net && s.net.otherPlayers >= 1');

      await b.close();
      bClosed = true;

      // The room's onLeave has to propagate, or dead ghosts accumulate.
      const alone = await waitForSnapshot(a.page, 's.net && s.net.otherPlayers === 0', 25_000);
      expect(alone.net!.otherPlayers).toBe(0);
      expect(alone.net!.connected).toBe(true);
    } finally {
      await a.close();
      if (!bClosed) await b.close();
    }
  });

  test('a connected client keeps simulating without network errors', async ({ page }) => {
    const errors = collectErrors(page);
    await bootClient(page);
    await enterGame(page);
    await waitForSnapshot(page, 's.net && s.net.connected');

    const box = await page.locator('canvas').boundingBox();
    expect(box).not.toBeNull();
    for (const fx of [0.8, 0.2, 0.5]) {
      await page.mouse.move(box!.x + box!.width * fx, box!.y + box!.height * 0.5);
      await page.mouse.down();
      await page.waitForTimeout(400);
      await page.mouse.up();
    }

    const s = await snapshot(page);
    expect(s.inGame).toBe(true);
    expect(s.net!.connected).toBe(true);
    expect(errors).toEqual([]);
  });
});

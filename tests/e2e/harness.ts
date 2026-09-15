import type { Page } from '@playwright/test';
import type { HarnessSnapshot, OmniviHarness } from '../../src/game/testHarness';

declare global {
  interface Window {
    __omnivi: OmniviHarness;
  }
}

/**
 * HTTP base of the Colyseus server. The systemd unit runs it on PORT=8000 and
 * the client's own default is ws://localhost:8000 — keep these in step, an
 * earlier revision of these tests probed :3001 and therefore skipped every
 * single case while the server was up and healthy.
 */
export const SERVER_HTTP = process.env.OMNIVI_SERVER_HTTP ?? 'http://localhost:8000';

/** True when the game server answers /health. */
export async function serverIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_HTTP}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Load the client and wait for the Phaser game + test harness to install. */
export async function bootClient(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__omnivi?.snapshot === 'function', {
    timeout: 15_000,
  });
  // Boot → Preloader → MainMenu runs over a few frames; wait for the menu so we
  // never drive a scene transition while the SceneManager is mid-boot.
  await page.waitForFunction(
    () => window.__omnivi.activeScenes().includes('MainMenu'),
    { timeout: 15_000 },
  );
}

/**
 * Jump into the gameplay scene. Menu buttons are canvas-drawn, so clicking
 * them means clicking hard-coded pixel coordinates that break on every UI
 * retouch — the harness starts the scene directly instead.
 *
 * `practiceMode` buys room isolation as much as it bypasses the blockchain checks: the
 * server defines "omnivi" with `.filterBy(["practice", "testnet"])`, so practice clients
 * land in a room of their own. Any test that lets a round actually START must pass it —
 * a live round leaves bots alive in the shared room, and the cases asserting a solo
 * lobby or `otherPlayers === 0` then fail on the *next* run against the same server.
 */
export async function enterGame(page: Page, practiceMode = false): Promise<void> {
  await page.evaluate(
    (practice) => window.__omnivi.start('Main', { practiceMode: practice }),
    practiceMode,
  );
  await page.waitForFunction(() => window.__omnivi.snapshot().inGame, { timeout: 15_000 });
}

export function snapshot(page: Page): Promise<HarnessSnapshot> {
  return page.evaluate(() => window.__omnivi.snapshot());
}

/**
 * Wait until `expr` — a JS expression over the snapshot, bound to `s` — is
 * true, then return that snapshot. Passed as source because the predicate runs
 * in the page, where a closure over test-side variables would not exist.
 */
export async function waitForSnapshot(
  page: Page,
  expr: string,
  timeout = 15_000,
): Promise<HarnessSnapshot> {
  const handle = await page.waitForFunction(
    `(() => { const s = window.__omnivi.snapshot(); return (${expr}) ? s : null; })()`,
    undefined,
    { timeout },
  );
  return handle.jsonValue() as Promise<HarnessSnapshot>;
}

/** Collected console errors and page exceptions, for "did it crash" assertions. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

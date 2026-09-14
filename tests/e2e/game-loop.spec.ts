import { test, expect } from '@playwright/test';
import {
  SERVER_HTTP,
  bootClient,
  collectErrors,
  enterGame,
  serverIsUp,
  snapshot,
  waitForSnapshot,
} from './harness';

/**
 * End-to-end coverage of the core loop against a real browser and a real
 * Colyseus server. Assertions go through window.__omnivi (src/game/testHarness)
 * because the whole game — menus, HUD, world — is canvas pixels with no DOM.
 */
test.describe('Omnivi E2E: Core Game Loop', () => {
  let serverUp = false;

  test.beforeAll(async () => {
    serverUp = await serverIsUp();
  });

  test.beforeEach(() => {
    test.skip(!serverUp, `No game server at ${SERVER_HTTP} — start omnivi-server`);
  });

  test('client boots Phaser through to the main menu', async ({ page }) => {
    const errors = collectErrors(page);
    await bootClient(page);

    const s = await snapshot(page);
    expect(s.activeScenes).toContain('MainMenu');
    expect(s.canvas.width).toBeGreaterThan(0);
    expect(s.canvas.height).toBeGreaterThan(0);
    expect(s.inGame).toBe(false);
    expect(errors).toEqual([]);
  });

  test('entering the game spawns a local player with mass', async ({ page }) => {
    await bootClient(page);
    await enterGame(page);

    const s = await snapshot(page);
    expect(s.activeScenes).toContain('Main');
    expect(s.activeScenes).not.toContain('MainMenu');
    expect(s.player).not.toBeNull();
    expect(s.player!.mass).toBeGreaterThan(0);
    expect(s.player!.radius).toBeGreaterThan(0);
    // Spawn is the world centre (also the black hole's future epicentre).
    expect(s.player!.x).toBeGreaterThan(0);
    expect(s.player!.y).toBeGreaterThan(0);
  });

  test('world seeds dust and asteroids locally, and holds in lobby solo', async ({ page }) => {
    await bootClient(page);
    await enterGame(page);

    const s = await snapshot(page);
    expect(s.dust).toBeGreaterThan(0);
    expect(s.asteroids).toBeGreaterThan(0);
    // Client-side bots were retired (constants: BOT_COUNT = 0) — NPCs now live
    // in OmniviRoom, and OmniviRoom only spawns them when the round starts, so a
    // solo client legitimately sees no other player at all.
    expect(s.bots).toBe(0);
    const solo = await waitForSnapshot(page, "s.net && s.net.phase === 'lobby'");
    expect(solo.net!.otherPlayers).toBe(0);
  });

  test('physics engine advances the simulation', async ({ page }) => {
    await bootClient(page);
    await enterGame(page);

    // Sampling only the player would pass on a frozen sim if it happened to
    // spawn at rest on the attractor, so watch the dust population too — it is
    // consumed and promoted to asteroids continuously while the round runs.
    const before = await page.evaluate(() => {
      const s = window.__omnivi.snapshot();
      return { t: performance.now(), player: s.player, dust: s.dust };
    });
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => {
      const s = window.__omnivi.snapshot();
      return { t: performance.now(), player: s.player, dust: s.dust };
    });

    expect(after.t - before.t).toBeGreaterThan(1000);
    const moved =
      after.dust !== before.dust ||
      after.player!.x !== before.player!.x ||
      after.player!.y !== before.player!.y ||
      after.player!.mass !== before.player!.mass;
    expect(moved, 'simulation state did not change over 1.5s').toBe(true);
  });

  test('client joins a Colyseus room and receives server state', async ({ page }) => {
    await bootClient(page);
    await enterGame(page);

    const joined = await waitForSnapshot(page, 's.net && s.net.connected && s.net.sessionId');
    expect(joined.net!.connected).toBe(true);
    expect(joined.net!.sessionId).toMatch(/^\S+$/);

    // The room broadcasts its phase (lobby / active / …) in the first patches.
    const withPhase = await waitForSnapshot(page, 's.net && s.net.phase');
    expect(withPhase.net!.phase).not.toBe('');
  });

  test('holding thrust accelerates the player and burns mass', async ({ page }) => {
    await bootClient(page);
    await enterGame(page);
    const errors = collectErrors(page);

    const start = await snapshot(page);
    const startSpeed = Math.hypot(start.player!.vx, start.player!.vy);

    // Default input mode aims with the pointer and thrusts while it is held
    // down (InputManager: `thrusting: this.mouseDown`).
    const box = await page.locator('canvas').boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.85, box!.y + box!.height * 0.5);
    await page.mouse.down();
    await page.waitForTimeout(1000);
    await page.mouse.up();

    const end = await snapshot(page);
    const endSpeed = Math.hypot(end.player!.vx, end.player!.vy);
    expect(endSpeed).toBeGreaterThan(startSpeed);
    // Thrust ejects mass — burning fuel has to cost something.
    expect(end.player!.mass).toBeLessThan(start.player!.mass);
    expect(errors).toEqual([]);
  });

  test('ability and UI keys do not crash the scene', async ({ page }) => {
    await bootClient(page);
    await enterGame(page);
    const errors = collectErrors(page);

    for (const key of ['1', '2', '3', '4', 'Shift', 'Tab', 'n']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(120);
    }

    const s = await snapshot(page);
    expect(s.inGame, 'game scene died after key input').toBe(true);
    expect(errors).toEqual([]);
  });
});

/**
 * E2E test harness.
 *
 * Phaser draws the entire game — menus, HUD text, the world — into a single
 * <canvas>, so a browser-driven test can see literally nothing through DOM
 * selectors: `page.getByText("Free Tier")` can never match a string that only
 * ever existed as canvas pixels. This hook is the only way an out-of-process
 * test can observe whether the game loop is actually running.
 *
 * It exposes a small, strictly JSON-serialisable view of live state on
 * `window.__omnivi` (Playwright's `page.evaluate` can only marshal plain data
 * back across the boundary — returning a Phaser object yields `{}`), plus a
 * scene-transition trigger so tests can drive Boot → Lobby → Main without
 * clicking pixel coordinates that move whenever the UI is retouched.
 *
 * Installed by `StartGame` only when `import.meta.env.DEV` or `VITE_E2E=1`,
 * so production bundles drop it entirely.
 */

/** Local player state, as the client's own physics sees it. */
export interface HarnessPlayer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  radius: number;
  rotation: number;
  /** Seconds remaining in escape sequence, 0 if not escaping. */
  escapeTimer: number;
  /** Flash intensity when absorbing objects (0–1), fades each frame. */
  absorbFlashIntensity: number;
}

/** Colyseus connection state, or null when the Main scene has no network manager. */
export interface HarnessNet {
  connected: boolean;
  sessionId: string;
  otherPlayers: number;
  gravityWells: number;
  serverMass: number;
  phase: string;
  shrinkTimer: number;
  prizePool: number;
  /** `positions_update` batches received, and remote positions applied from them. */
  positionBatches: number;
  positionUpdatesApplied: number;
}

export interface HarnessSnapshot {
  /** Scene keys Phaser currently considers active, e.g. ["Main"]. */
  activeScenes: string[];
  /** True once the Main (gameplay) scene is running. */
  inGame: boolean;
  /** Canvas backing-store size — 0x0 means the renderer never came up. */
  canvas: { width: number; height: number };
  player: HarnessPlayer | null;
  bots: number;
  dust: number;
  asteroids: number;
  net: HarnessNet | null;
}

export interface OmniviHarness {
  activeScenes(): string[];
  snapshot(): HarnessSnapshot;
  /** Jump straight to a scene, bypassing canvas-drawn buttons. */
  start(sceneKey: string, data?: Record<string, unknown>): void;
}

function findScene(game: Phaser.Game, key: string): Phaser.Scene | null {
  const scene = game.scene.getScene(key);
  return scene && game.scene.isActive(key) ? scene : null;
}

function readPlayer(main: any): HarnessPlayer | null {
  const p = main?.player;
  if (!p) return null;
  return {
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    mass: p.mass,
    radius: p.radius,
    rotation: p.rotation,
    escapeTimer: main?.escapeTimer ?? 0,
    absorbFlashIntensity: main?.absorbFlashTimer ?? 0,
  };
}

function readNet(main: any): HarnessNet | null {
  const net = main?.net;
  if (!net) return null;
  const state = net.gameState ?? {};
  return {
    connected: net.connected === true,
    sessionId: net.mySessionId ?? "",
    otherPlayers: net.otherPlayers?.size ?? 0,
    gravityWells: net.gravityWells?.size ?? 0,
    serverMass: net.serverMass ?? 0,
    phase: state.phase ?? "",
    shrinkTimer: state.shrinkTimer ?? 0,
    prizePool: state.prizePool ?? 0,
    positionBatches: net.positionBatches ?? 0,
    positionUpdatesApplied: net.positionUpdatesApplied ?? 0,
  };
}

export function installTestHarness(game: Phaser.Game): void {
  const harness: OmniviHarness = {
    activeScenes: () =>
      game.scene.getScenes(true).map((s) => s.scene.key),

    snapshot: () => {
      const main = findScene(game, "Main") as any;
      return {
        activeScenes: game.scene.getScenes(true).map((s) => s.scene.key),
        inGame: main !== null,
        canvas: {
          width: game.canvas?.width ?? 0,
          height: game.canvas?.height ?? 0,
        },
        player: readPlayer(main),
        bots: main?.bots?.length ?? 0,
        dust: main?.dust?.length ?? 0,
        asteroids: main?.asteroids?.length ?? 0,
        net: readNet(main),
      };
    },

    start: (sceneKey, data) => {
      // SceneManager.start() does NOT stop the caller the way Scene.scene.start()
      // does, so without this the menu keeps running and drawing over Main.
      for (const s of game.scene.getScenes(true)) {
        if (s.scene.key !== sceneKey) game.scene.stop(s.scene.key);
      }
      game.scene.start(sceneKey, data);
    },
  };

  (window as unknown as { __omnivi: OmniviHarness }).__omnivi = harness;
}

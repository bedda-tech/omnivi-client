import Phaser from "phaser";
import { EventBus } from "../EventBus";
import { NetworkManager } from "../NetworkManager";
import { connectWallet } from "../blockchain/ClaimClient";

// ─── Constants ─────────────────────────────────────────────────────────────
const WORLD_SIZE = 5000;
const RADIUS_SCALE = 2.0;        // radius = sqrt(mass) * RADIUS_SCALE
const STARTING_MASS = 1000;
const THRUST_FORCE = 250;        // pixels/s² acceleration
const THRUST_MASS_COST = 0.8;    // mass lost per thrust tick (60fps assumed)
const DRAG = 0.992;              // velocity multiplier per frame
const MAX_SPEED = 500;
const DUST_EMIT_MASS = 2;        // mass of each emitted dust particle
const INITIAL_DUST_COUNT = 300;  // dust seeded at match start
const MAX_DUST = 600;
const ABSORB_RATIO = 1.5;        // must be this times larger to absorb
const DUST_RESPAWN_MIN = 150;    // respawn ambient dust when count falls below this

// ─── Asteroid ───────────────────────────────────────────────────────────────
const ASTEROID_THRESHOLD = 50;  // dust mass at which it graduates to Asteroid
const PLANET_THRESHOLD = 1000;  // asteroid mass at which it's labeled a Planet
const INITIAL_ASTEROIDS = 6;    // asteroid bodies seeded at match start
const ASTEROID_DRAG = 0.9995;   // asteroids resist drag (momentum conservation)
const ASTEROID_VERTICES = 10;   // polygon vertex count for craggy look

// ─── Gravity (Barnes-Hut) ───────────────────────────────────────────────────
const GRAVITY_G = 800;           // gravitational constant (tune for feel)
const GRAVITY_THETA = 0.5;       // Barnes-Hut approximation threshold
const GRAVITY_MIN_DIST_SQ = 900; // 30px — avoid singularity
const MAX_G_ACCEL = 500;         // px/s² cap (prevents lag-spike explosions)

// ─── Black Hole / Big Shrink ─────────────────────────────────────────────────
const SHRINK_START_DELAY = 90;    // seconds of normal play before Big Shrink
const BH_INITIAL_MASS    = 8000;  // starting BH mass (radius ≈ 179px)
const BH_GROWTH_RATE     = 200;   // mass/second added to BH
const BH_GRAVITY_MULT    = 5.0;   // BH gravity multiplier over GRAVITY_G

// ─── Escape Sequence ────────────────────────────────────────────────────────
const ESCAPE_DURATION      = 12;    // seconds to complete escape
const ESCAPE_MIN_DIST      = 1600;  // must be this far from world center (px)
const ESCAPE_DISRUPT_RATIO = 0.5;   // disrupted if hit by object > this × player mass

type GamePhase = 'playing' | 'shrinking' | 'escaped' | 'consumed';

function massToRadius(mass: number): number {
  return Math.sqrt(mass) * RADIUS_SCALE;
}

/** Parse "hsl(H,S%,L%)" → Phaser hex color int (fast, good-enough for integer hue). */
function parseHslColor(hsl: string): number {
  // Match hsl(hue, sat%, lig%) — handles space/no-space variants
  const m = hsl.match(/hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%/i);
  if (!m) return 0xffffff;
  return Phaser.Display.Color.HSLToColor(
    parseInt(m[1]) / 360,
    parseInt(m[2]) / 100,
    parseInt(m[3]) / 100,
  ).color;
}

// ─── Dust ──────────────────────────────────────────────────────────────────
class DustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  active: boolean = true;

  constructor(x: number, y: number, vx: number, vy: number, mass: number) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.mass = mass;
  }

  get radius(): number {
    return massToRadius(this.mass);
  }

  update(dt: number) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.999;
    this.vy *= 0.999;
    // Soft bounce at world edges
    if (this.x < 0) { this.x = 0; this.vx = Math.abs(this.vx); }
    if (this.x > WORLD_SIZE) { this.x = WORLD_SIZE; this.vx = -Math.abs(this.vx); }
    if (this.y < 0) { this.y = 0; this.vy = Math.abs(this.vy); }
    if (this.y > WORLD_SIZE) { this.y = WORLD_SIZE; this.vy = -Math.abs(this.vy); }
  }
}

// ─── Asteroid ──────────────────────────────────────────────────────────────
class Asteroid {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  rotation: number;
  rotationSpeed: number;  // rad/s
  active: boolean = true;
  // Pre-computed per-vertex radius multipliers for craggy polygon shape [0.65..1.35]
  shapeOffsets: number[];

  constructor(x: number, y: number, vx: number, vy: number, mass: number) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.mass = mass;
    this.rotation = Math.random() * Math.PI * 2;
    this.rotationSpeed = (Math.random() - 0.5) * 0.6; // rad/s
    this.shapeOffsets = Array.from({ length: ASTEROID_VERTICES }, () =>
      0.65 + Math.random() * 0.7
    );
  }

  get radius(): number {
    return massToRadius(this.mass);
  }

  update(dt: number) {
    this.rotation += this.rotationSpeed * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const dragFactor = Math.pow(ASTEROID_DRAG, dt * 60);
    this.vx *= dragFactor;
    this.vy *= dragFactor;
    // Bounce at world edges (less energy loss than player, asteroids are denser)
    const r = this.radius;
    if (this.x < r) { this.x = r; this.vx = Math.abs(this.vx) * 0.85; }
    if (this.x > WORLD_SIZE - r) { this.x = WORLD_SIZE - r; this.vx = -Math.abs(this.vx) * 0.85; }
    if (this.y < r) { this.y = r; this.vy = Math.abs(this.vy) * 0.85; }
    if (this.y > WORLD_SIZE - r) { this.y = WORLD_SIZE - r; this.vy = -Math.abs(this.vy) * 0.85; }
  }
}

// ─── Barnes-Hut QuadTree ────────────────────────────────────────────────────
class QuadNode {
  cx = 0; cy = 0; totalMass = 0;
  body: DustParticle | null = null;
  nw: QuadNode | null = null;
  ne: QuadNode | null = null;
  sw: QuadNode | null = null;
  se: QuadNode | null = null;

  constructor(
    readonly minX: number,
    readonly minY: number,
    readonly maxX: number,
    readonly maxY: number,
  ) {}

  get size() { return this.maxX - this.minX; }

  insert(b: DustParticle): void {
    if (this.totalMass === 0) {
      this.body = b;
      this.cx = b.x; this.cy = b.y; this.totalMass = b.mass;
      return;
    }
    if (this.body !== null) {
      this._sub(this.body);
      this.body = null;
    }
    const t = this.totalMass + b.mass;
    this.cx = (this.cx * this.totalMass + b.x * b.mass) / t;
    this.cy = (this.cy * this.totalMass + b.y * b.mass) / t;
    this.totalMass = t;
    this._sub(b);
  }

  private _sub(b: DustParticle): void {
    const mx = (this.minX + this.maxX) * 0.5;
    const my = (this.minY + this.maxY) * 0.5;
    if (b.x < mx) {
      if (b.y < my) { if (!this.nw) this.nw = new QuadNode(this.minX, this.minY, mx, my); this.nw.insert(b); }
      else           { if (!this.sw) this.sw = new QuadNode(this.minX, my, mx, this.maxY); this.sw.insert(b); }
    } else {
      if (b.y < my) { if (!this.ne) this.ne = new QuadNode(mx, this.minY, this.maxX, my); this.ne.insert(b); }
      else           { if (!this.se) this.se = new QuadNode(mx, my, this.maxX, this.maxY); this.se.insert(b); }
    }
  }

  /** Gravitational acceleration at (bx, by) from all bodies in this node, skipping `skip`. */
  accelAt(bx: number, by: number, skip: DustParticle, theta: number): [number, number] {
    if (this.totalMass === 0) return [0, 0];
    if (this.body === skip)   return [0, 0];

    const dx = this.cx - bx;
    const dy = this.cy - by;
    const distSq = dx * dx + dy * dy;
    if (distSq < GRAVITY_MIN_DIST_SQ) return [0, 0];

    if (this.body !== null || this.size / Math.sqrt(distSq) < theta) {
      const dist = Math.sqrt(distSq);
      const a = GRAVITY_G * this.totalMass / distSq;
      return [a * dx / dist, a * dy / dist];
    }

    let ax = 0, ay = 0;
    for (const c of [this.nw, this.ne, this.sw, this.se]) {
      if (c) { const [cx, cy] = c.accelAt(bx, by, skip, theta); ax += cx; ay += cy; }
    }
    return [ax, ay];
  }
}

// ─── Player ────────────────────────────────────────────────────────────────
class Player {
  x: number;
  y: number;
  vx: number = 0;
  vy: number = 0;
  mass: number;
  rotation: number = 0; // radians; 0 = right
  thrustingThisFrame: boolean = false;

  constructor(x: number, y: number, mass: number) {
    this.x = x;
    this.y = y;
    this.mass = mass;
  }

  get radius(): number {
    return massToRadius(this.mass);
  }

  /**
   * Apply thrust in the direction of this.rotation.
   * Costs THRUST_MASS_COST mass per frame and returns ejected dust data.
   */
  applyThrust(dt: number): { x: number; y: number; vx: number; vy: number; mass: number } | null {
    if (this.mass <= 15) return null;

    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);

    // Accelerate forward
    this.vx += cos * THRUST_FORCE * dt;
    this.vy += sin * THRUST_FORCE * dt;

    // Clamp speed
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > MAX_SPEED) {
      this.vx = (this.vx / speed) * MAX_SPEED;
      this.vy = (this.vy / speed) * MAX_SPEED;
    }

    // Expel mass as dust from the back of the player
    const massLost = THRUST_MASS_COST;
    this.mass = Math.max(15, this.mass - massLost);

    const ejectSpeed = 150;
    return {
      x: this.x - cos * (this.radius + 2),
      y: this.y - sin * (this.radius + 2),
      vx: this.vx - cos * ejectSpeed,
      vy: this.vy - sin * ejectSpeed,
      mass: DUST_EMIT_MASS,
    };
  }

  update(dt: number) {
    // Apply drag
    const dragFactor = Math.pow(DRAG, dt * 60);
    this.vx *= dragFactor;
    this.vy *= dragFactor;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // World boundary bounce
    const r = this.radius;
    if (this.x < r) { this.x = r; this.vx = Math.abs(this.vx) * 0.5; }
    if (this.x > WORLD_SIZE - r) { this.x = WORLD_SIZE - r; this.vx = -Math.abs(this.vx) * 0.5; }
    if (this.y < r) { this.y = r; this.vy = Math.abs(this.vy) * 0.5; }
    if (this.y > WORLD_SIZE - r) { this.y = WORLD_SIZE - r; this.vy = -Math.abs(this.vy) * 0.5; }
  }
}

// ─── Main Scene ────────────────────────────────────────────────────────────
export class Main extends Phaser.Scene {
  private player!: Player;
  private dust: DustParticle[] = [];
  private asteroids: Asteroid[] = [];

  // Rendering
  private gfx!: Phaser.GameObjects.Graphics;
  private gridGfx!: Phaser.GameObjects.Graphics;
  private vignetteGfx!: Phaser.GameObjects.Graphics;  // screen-space overlay

  // HUD
  private massText!: Phaser.GameObjects.Text;
  private phaseText!: Phaser.GameObjects.Text;        // phase/escape status (center-top)
  private endText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private restartText!: Phaser.GameObjects.Text;
  private menuKeyText!: Phaser.GameObjects.Text;
  private minimapGfx!: Phaser.GameObjects.Graphics;  // screen-space minimap overlay
  private leaderboardText!: Phaser.GameObjects.Text; // top-right mass ranking

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyE!: Phaser.Input.Keyboard.Key;           // initiate escape
  private pointer!: Phaser.Input.Pointer;
  private mouseDown: boolean = false;
  private gamepad: Phaser.Input.Gamepad.Gamepad | null = null;

  // Input mode
  private useMouse: boolean = true;
  private useKeyboard: boolean = false;
  private useGamepad: boolean = false;

  // ── Multiplayer ─────────────────────────────────────────────────────────
  private net: NetworkManager | null = null;
  private sendTimer: number = 0;    // seconds since last network send
  private readonly SEND_RATE = 1 / 20; // 20 Hz
  /** Session IDs we've already absorbed this life — prevents double-counting. */
  private absorbedPlayers = new Set<string>();
  /** Connected wallet address (if MetaMask available), used for on-chain claim. */
  private walletAddress: string = "";

  // ── Game phase / Big Shrink state ──────────────────────────────────────
  private phase!: GamePhase;
  private gameTimer!: number;       // seconds elapsed since game start
  private shrinkTimer!: number;     // seconds elapsed since shrink started
  private bhMass!: number;          // black hole mass (grows during shrink)
  private escaping!: boolean;       // player is in escape countdown
  private escapeTimer!: number;     // seconds remaining in escape countdown
  private disruptFlash!: number;    // seconds remaining for disruption red flash

  constructor() {
    super("Main");
  }

  preload() {}

  create() {
    this.cameras.main.setBounds(0, 0, WORLD_SIZE, WORLD_SIZE);

    // Background grid (static, drawn once)
    this.gridGfx = this.add.graphics();
    this.drawGrid();

    // Main dynamic graphics
    this.gfx = this.add.graphics();

    // Screen-space overlay (vignette, disruption flash)
    this.vignetteGfx = this.add.graphics().setScrollFactor(0).setDepth(18);

    // Player
    this.player = new Player(WORLD_SIZE / 2, WORLD_SIZE / 2, STARTING_MASS);

    // Seed initial dust scattered around the world
    this.dust = [];
    this.asteroids = [];
    for (let i = 0; i < INITIAL_DUST_COUNT; i++) {
      const x = Math.random() * WORLD_SIZE;
      const y = Math.random() * WORLD_SIZE;
      const mass = DUST_EMIT_MASS + Math.random() * 8;
      const speed = Math.random() * 15;
      const angle = Math.random() * Math.PI * 2;
      this.dust.push(new DustParticle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, mass));
    }

    // Seed initial asteroids (spread away from center to avoid instant player collision)
    for (let i = 0; i < INITIAL_ASTEROIDS; i++) {
      // Place in a ring between 800–2000px from center
      const angle = (i / INITIAL_ASTEROIDS) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 800 + Math.random() * 1200;
      const x = WORLD_SIZE / 2 + Math.cos(angle) * dist;
      const y = WORLD_SIZE / 2 + Math.sin(angle) * dist;
      const mass = ASTEROID_THRESHOLD + Math.random() * 300; // 50–350 mass
      const speed = Math.random() * 25;
      const avel = Math.random() * Math.PI * 2;
      this.asteroids.push(
        new Asteroid(x, y, Math.cos(avel) * speed, Math.sin(avel) * speed, mass)
      );
    }

    // ── Game state (reset on restart) ──────────────────────────────────
    this.phase          = 'playing';
    this.gameTimer      = 0;
    this.shrinkTimer    = 0;
    this.bhMass         = BH_INITIAL_MASS;
    this.escaping       = false;
    this.escapeTimer    = 0;
    this.disruptFlash   = 0;
    this.absorbedPlayers.clear();

    // HUD elements — setScrollFactor(0) pins them to the screen
    this.massText = this.add
      .text(16, 16, "", {
        fontSize: "16px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3,
        lineSpacing: 4,
      })
      .setScrollFactor(0)
      .setDepth(20);

    this.add
      .text(16, 136, "Mouse: point to aim  |  Click/Hold: thrust\nWASD / Arrow keys: rotate & thrust", {
        fontSize: "12px",
        color: "#aaaaaa",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setScrollFactor(0)
      .setDepth(20);

    // Phase/escape status — centered at top
    this.phaseText = this.add
      .text(512, 12, "", {
        fontSize: "15px",
        color: "#ffcc00",
        stroke: "#000000",
        strokeThickness: 3,
        align: "center",
      })
      .setScrollFactor(0)
      .setDepth(20)
      .setOrigin(0.5, 0);

    // End-screen overlay elements (hidden until game ends)
    this.endText = this.add
      .text(512, 210, "", {
        fontFamily: "Arial Black",
        fontSize: "44px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 6,
        align: "center",
      })
      .setScrollFactor(0)
      .setDepth(30)
      .setOrigin(0.5)
      .setVisible(false);

    this.statsText = this.add
      .text(512, 300, "", {
        fontFamily: "monospace",
        fontSize: "18px",
        color: "#dddddd",
        stroke: "#000000",
        strokeThickness: 3,
        align: "center",
        lineSpacing: 6,
      })
      .setScrollFactor(0)
      .setDepth(30)
      .setOrigin(0.5)
      .setVisible(false);

    this.restartText = this.add
      .text(512, 405, "[ R ]  Play Again", {
        fontSize: "20px",
        color: "#00ff88",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setScrollFactor(0)
      .setDepth(30)
      .setOrigin(0.5)
      .setVisible(false);

    this.menuKeyText = this.add
      .text(512, 438, "[ M ]  Main Menu", {
        fontSize: "20px",
        color: "#aaaaff",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setScrollFactor(0)
      .setDepth(30)
      .setOrigin(0.5)
      .setVisible(false);

    // Minimap — screen-space overlay, bottom-right
    this.minimapGfx = this.add.graphics().setScrollFactor(0).setDepth(22);

    // Leaderboard — top-right, right-anchored
    this.leaderboardText = this.add
      .text(this.scale.width - 14, 14, "", {
        fontSize: "13px",
        color: "#dddddd",
        stroke: "#000000",
        strokeThickness: 3,
        lineSpacing: 3,
        fontFamily: "monospace",
      })
      .setScrollFactor(0)
      .setDepth(22)
      .setOrigin(1, 0);

    // Keyboard input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyW = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyE = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    // Mouse input
    this.pointer = this.input.activePointer;
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      this.pointer = p;
      this.useMouse = true;
      this.useKeyboard = false;
      this.useGamepad = false;
    });
    this.input.on("pointerdown", () => {
      this.mouseDown = true;
    });
    this.input.on("pointerup", () => {
      this.mouseDown = false;
    });

    // Gamepad input
    this.input.gamepad?.once(
      Phaser.Input.Gamepad.Events.CONNECTED,
      (pad: Phaser.Input.Gamepad.Gamepad) => {
        this.gamepad = pad;
        this.useGamepad = true;
        this.useMouse = false;
        this.useKeyboard = false;
      }
    );

    // Initial camera
    this.cameras.main.setZoom(1);
    this.cameras.main.centerOn(this.player.x, this.player.y);

    // ── Wallet: request MetaMask accounts early (non-blocking) ───────
    connectWallet().then((addr) => {
      this.walletAddress = addr;
      if (addr) console.log("[Wallet] Connected:", addr);
    });

    // ── Network: connect to Colyseus server (graceful if offline) ─────
    this.net = new NetworkManager();
    this.net.connect().catch((err: unknown) => {
      console.warn("[Net] Server unavailable — playing offline:", err);
      this.net = null;
    });

    // When server sends a signed claim after escape, surface it to the React layer via DOM event
    this.net?.onClaimReady((payload) => {
      window.dispatchEvent(new CustomEvent("omnivi:claim_ready", { detail: payload }));
    });

    EventBus.emit("current-scene-ready", this);
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta / 1000, 0.05); // cap at 50 ms to prevent lag-spike explosions

    // ── Timer & phase transitions ────────────────────────────────────────
    this.gameTimer += dt;
    if (this.phase === 'playing' && this.gameTimer >= SHRINK_START_DELAY) {
      this.phase = 'shrinking';
    }

    // ── Freeze game logic when ended; still draw and handle R key ───────
    if (this.phase === 'escaped' || this.phase === 'consumed') {
      this.drawVignette();
      this.drawScene();
      return;
    }

    // ── Determine input mode ────────────────────────────────────────────
    const keyLeft = this.cursors.left?.isDown || this.keyA.isDown;
    const keyRight = this.cursors.right?.isDown || this.keyD.isDown;
    const keyUp = this.cursors.up?.isDown || this.keyW.isDown;
    const keyDown = this.cursors.down?.isDown || this.keyS.isDown;
    const anyKey = keyLeft || keyRight || keyUp || keyDown;

    if (anyKey) {
      this.useKeyboard = true;
      this.useMouse = false;
      this.useGamepad = false;
    }

    // ── Compute aim direction and thrust intent ─────────────────────────
    let thrusting = false;

    if (this.useKeyboard) {
      if (keyLeft) this.player.rotation -= 2.2 * dt;
      if (keyRight) this.player.rotation += 2.2 * dt;
      if (keyUp) thrusting = true;
      if (keyDown) {
        // Brake: apply thrust backward
        this.player.rotation += Math.PI;
        thrusting = true;
        this.player.rotation -= Math.PI;
      }
      if (keyUp) thrusting = true;
    }

    if (this.useGamepad && this.gamepad) {
      const lx = this.gamepad.leftStick?.x ?? 0;
      const ly = this.gamepad.leftStick?.y ?? 0;
      const rt = (this.gamepad as any).R2 ?? 0;
      if (Math.hypot(lx, ly) > 0.1) {
        this.player.rotation = Math.atan2(ly, lx);
      }
      if (rt > 0.1) thrusting = true;
    }

    if (this.useMouse) {
      this.player.rotation = Phaser.Math.Angle.Between(
        this.player.x,
        this.player.y,
        this.pointer.worldX,
        this.pointer.worldY
      );
      if (this.mouseDown) thrusting = true;
    }

    // ── Apply thrust (costs mass, emits dust) ──────────────────────────
    this.player.thrustingThisFrame = thrusting;
    if (thrusting) {
      const ejected = this.player.applyThrust(dt);
      if (ejected && this.dust.length < MAX_DUST) {
        this.dust.push(
          new DustParticle(ejected.x, ejected.y, ejected.vx, ejected.vy, ejected.mass)
        );
      }
    }

    // ── Update player ──────────────────────────────────────────────────
    this.player.update(dt);

    // ── Gravity simulation ─────────────────────────────────────────────
    {
      // Build Barnes-Hut tree for dust-to-dust gravity
      const tree = new QuadNode(0, 0, WORLD_SIZE, WORLD_SIZE);
      for (const d of this.dust) tree.insert(d);

      const px = this.player.x;
      const py = this.player.y;
      const pm = this.player.mass;

      // Dust: gravity from other dust (Barnes-Hut) + player gravity + asteroid gravity
      for (const d of this.dust) {
        let [ax, ay] = this.dust.length > 0
          ? tree.accelAt(d.x, d.y, d, GRAVITY_THETA)
          : [0, 0];

        // Player as dominant gravity well
        {
          const dx = px - d.x;
          const dy = py - d.y;
          const dSq = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
          const dist = Math.sqrt(dSq);
          const pa = GRAVITY_G * pm / dSq;
          ax += pa * dx / dist;
          ay += pa * dy / dist;
        }

        // Each asteroid is also a gravity well for dust
        for (const a of this.asteroids) {
          const dx = a.x - d.x;
          const dy = a.y - d.y;
          const dSq = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
          const dist = Math.sqrt(dSq);
          const ag = GRAVITY_G * a.mass / dSq;
          ax += ag * dx / dist;
          ay += ag * dy / dist;
        }

        const mag = Math.hypot(ax, ay);
        if (mag > MAX_G_ACCEL) { ax = ax / mag * MAX_G_ACCEL; ay = ay / mag * MAX_G_ACCEL; }
        d.vx += ax * dt;
        d.vy += ay * dt;
      }

      // Asteroid-to-asteroid gravity (N² but count stays small)
      for (let i = 0; i < this.asteroids.length; i++) {
        const a = this.asteroids[i];
        for (let j = i + 1; j < this.asteroids.length; j++) {
          const b = this.asteroids[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dSq = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
          const dist = Math.sqrt(dSq);
          const f = GRAVITY_G / dSq / dist; // precompute /dist
          a.vx += b.mass * f * dx * dt;
          a.vy += b.mass * f * dy * dt;
          b.vx -= a.mass * f * dx * dt;
          b.vy -= a.mass * f * dy * dt;
        }
      }

      // Asteroid gravity on player (large rocks are dangerous!)
      for (const a of this.asteroids) {
        const dx = a.x - this.player.x;
        const dy = a.y - this.player.y;
        const dSq = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
        const dist = Math.sqrt(dSq);
        let ag = GRAVITY_G * a.mass / dSq;
        let agx = ag * dx / dist;
        let agy = ag * dy / dist;
        const amag = Math.hypot(agx, agy);
        if (amag > MAX_G_ACCEL) { agx = agx / amag * MAX_G_ACCEL; agy = agy / amag * MAX_G_ACCEL; }
        this.player.vx += agx * dt;
        this.player.vy += agy * dt;
      }
    }

    // ── Update positions ───────────────────────────────────────────────
    for (const d of this.dust) d.update(dt);
    for (const a of this.asteroids) a.update(dt);

    // ── Dust-to-dust merging ────────────────────────────────────────────
    this.mergeDust();

    // ── Promote large dust → Asteroid ──────────────────────────────────
    this.promoteDust();

    // ── Asteroid absorbs nearby dust ───────────────────────────────────
    this.asteroidAbsorbsDust();

    // ── Asteroids merge with each other (planet formation) ─────────────
    this.mergeAsteroids();

    // ── Player absorbs dust ────────────────────────────────────────────
    {
      const pr = this.player.radius;
      const px = this.player.x;
      const py = this.player.y;
      let absorbed = false;
      for (const d of this.dust) {
        if (!d.active) continue;
        if (this.player.mass < d.mass * ABSORB_RATIO) continue;
        const dx = d.x - px;
        const dy = d.y - py;
        if (dx * dx + dy * dy < (pr + d.radius) * (pr + d.radius)) {
          this.player.mass += d.mass;
          d.active = false;
          absorbed = true;
        }
      }
      if (absorbed) this.dust = this.dust.filter(d => d.active);
    }

    // ── Player absorbs asteroids ────────────────────────────────────────
    {
      const pr = this.player.radius;
      const px = this.player.x;
      const py = this.player.y;
      let absorbed = false;
      for (const a of this.asteroids) {
        if (!a.active) continue;
        if (this.player.mass < a.mass * ABSORB_RATIO) continue;
        const dx = a.x - px;
        const dy = a.y - py;
        if (dx * dx + dy * dy < (pr + a.radius) * (pr + a.radius)) {
          // Momentum conservation: the player is absorbing a moving body
          const tm = this.player.mass + a.mass;
          this.player.vx = (this.player.vx * this.player.mass + a.vx * a.mass) / tm;
          this.player.vy = (this.player.vy * this.player.mass + a.vy * a.mass) / tm;
          this.player.mass = tm;
          a.active = false;
          absorbed = true;
        }
      }
      if (absorbed) this.asteroids = this.asteroids.filter(a => a.active);
    }

    // ── PvP: player absorbs / is absorbed by remote players ────────────
    this.checkPvP();

    // ── The Big Shrink: black hole physics ─────────────────────────────
    if (this.phase === 'shrinking') {
      this.updateBlackHole(dt);
      this.updateEscape(dt);
    }

    // ── Network: send local player state at 20 Hz ──────────────────────
    this.sendTimer += dt;
    if (this.net && this.sendTimer >= this.SEND_RATE) {
      this.sendTimer = 0;
      this.net.sendPlayerState(
        this.player.x, this.player.y,
        this.player.vx, this.player.vy,
        this.player.mass,
        thrusting,
        this.escaping,
      );
    }

    // ── Camera: follow player with dynamic zoom ─────────────────────────
    const targetZoom = Phaser.Math.Clamp(550 / this.player.radius, 0.15, 3);
    const currentZoom = this.cameras.main.zoom;
    const newZoom = Phaser.Math.Linear(currentZoom, targetZoom, 0.04);
    this.cameras.main.setZoom(newZoom);
    this.cameras.main.centerOn(this.player.x, this.player.y);

    // ── HUD ─────────────────────────────────────────────────────────────
    const speed = Math.hypot(this.player.vx, this.player.vy);
    const planetCount = this.asteroids.filter(a => a.mass >= PLANET_THRESHOLD).length;
    const asteroidCount = this.asteroids.length - planetCount;
    this.massText.setText(
      [
        `Mass:     ${Math.floor(this.player.mass)}`,
        `Radius:   ${this.player.radius.toFixed(1)} px`,
        `Speed:    ${speed.toFixed(0)} px/s`,
        `Dust:     ${this.dust.length}`,
        `Asteroids:${asteroidCount}  Planets: ${planetCount}`,
        `Pos:      (${Math.floor(this.player.x)}, ${Math.floor(this.player.y)})`,
      ].join("\n")
    );

    this.updatePhaseHUD();

    // ── Render ──────────────────────────────────────────────────────────
    this.drawVignette();
    this.drawScene();
    this.drawMinimap();
    this.drawLeaderboard();
  }

  // ─── Black Hole Update ─────────────────────────────────────────────────────
  private updateBlackHole(dt: number) {
    this.shrinkTimer += dt;
    this.bhMass += BH_GROWTH_RATE * dt;

    const bhR  = massToRadius(this.bhMass);
    const bx   = WORLD_SIZE / 2;
    const by   = WORLD_SIZE / 2;
    const bhG  = GRAVITY_G * BH_GRAVITY_MULT;

    // BH gravity + absorption for dust
    for (const d of this.dust) {
      const dx = bx - d.x;
      const dy = by - d.y;
      const dSq  = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
      const dist = Math.sqrt(dSq);
      const a    = bhG * this.bhMass / dSq;
      d.vx += a * dx / dist * dt;
      d.vy += a * dy / dist * dt;
      if (dist < bhR + d.radius) d.active = false;
    }
    this.dust = this.dust.filter(d => d.active);

    // BH gravity + absorption for asteroids
    for (const a of this.asteroids) {
      const dx = bx - a.x;
      const dy = by - a.y;
      const dSq  = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
      const dist = Math.sqrt(dSq);
      const ag   = bhG * this.bhMass / dSq;
      let agx = ag * dx / dist;
      let agy = ag * dy / dist;
      const amag = Math.hypot(agx, agy);
      if (amag > MAX_G_ACCEL) { agx = agx / amag * MAX_G_ACCEL; agy = agy / amag * MAX_G_ACCEL; }
      a.vx += agx * dt;
      a.vy += agy * dt;
      if (dist < bhR + a.radius) {
        this.bhMass += a.mass * 0.3; // BH grows as it consumes mass
        a.active = false;
      }
    }
    this.asteroids = this.asteroids.filter(a => a.active);

    // BH gravity on player
    const pdx  = bx - this.player.x;
    const pdy  = by - this.player.y;
    const pdSq = Math.max(pdx * pdx + pdy * pdy, GRAVITY_MIN_DIST_SQ);
    const pdist = Math.sqrt(pdSq);
    let pag  = bhG * this.bhMass / pdSq;
    let pagX = pag * pdx / pdist;
    let pagY = pag * pdy / pdist;
    const pagMag = Math.hypot(pagX, pagY);
    if (pagMag > MAX_G_ACCEL) { pagX = pagX / pagMag * MAX_G_ACCEL; pagY = pagY / pagMag * MAX_G_ACCEL; }
    this.player.vx += pagX * dt;
    this.player.vy += pagY * dt;

    // Player consumed by BH
    if (pdist < bhR + this.player.radius) {
      this.phase = 'consumed';
      this.net?.sendConsumed();
      this.showEndScreen(false);
      return;
    }

    // Disruption: BH gravity too strong while escaping
    if (this.escaping && pagMag > MAX_G_ACCEL * 0.45) {
      this.disruptEscape("Too close to the singularity!");
    }
  }

  // ─── Escape Sequence Update ────────────────────────────────────────────────
  private updateEscape(dt: number) {
    // E key: start or cancel escape
    if (Phaser.Input.Keyboard.JustDown(this.keyE)) {
      if (!this.escaping) {
        const distFromCenter = Math.hypot(
          this.player.x - WORLD_SIZE / 2,
          this.player.y - WORLD_SIZE / 2
        );
        if (distFromCenter >= ESCAPE_MIN_DIST) {
          this.escaping    = true;
          this.escapeTimer = ESCAPE_DURATION;
        } else {
          // Too close — flash a warning
          this.disruptFlash = 1.5;
          this.phaseText.setText("TOO CLOSE TO CENTER — move to the outer edge!");
        }
      } else {
        // Cancel escape
        this.escaping    = false;
        this.escapeTimer = 0;
      }
    }

    if (!this.escaping) return;

    this.escapeTimer -= dt;
    if (this.disruptFlash > 0) this.disruptFlash -= dt;

    // Disruption: nearby asteroid/dust bigger than ESCAPE_DISRUPT_RATIO × player mass
    for (const a of this.asteroids) {
      if (a.mass < this.player.mass * ESCAPE_DISRUPT_RATIO) continue;
      const dx = a.x - this.player.x;
      const dy = a.y - this.player.y;
      if (dx * dx + dy * dy < (this.player.radius + a.radius) ** 2) {
        this.disruptEscape("Escape disrupted — impact!");
        return;
      }
    }

    // Escape complete!
    if (this.escapeTimer <= 0) {
      this.phase = 'escaped';
      this.net?.sendEscaped(this.walletAddress || undefined);
      this.showEndScreen(true);
    }
  }

  private disruptEscape(reason: string) {
    this.escaping     = false;
    this.escapeTimer  = 0;
    this.disruptFlash = 1.2;
    this.phaseText.setText(reason).setColor("#ff4400");
  }

  /**
   * PvP collision check: run after local player absorbs dust/asteroids.
   * - If local player overlaps a remote player and is ABSORB_RATIO× larger → absorb them.
   * - If a remote player overlaps local and is ABSORB_RATIO× larger → we die.
   */
  private checkPvP() {
    if (!this.net) return;
    if (this.phase === 'escaped' || this.phase === 'consumed') return;

    const px = this.player.x;
    const py = this.player.y;
    const pr = this.player.radius;
    const pm = this.player.mass;

    for (const [, rp] of this.net.otherPlayers) {
      if (rp.phase !== 'alive') continue;
      if (this.absorbedPlayers.has(rp.id)) continue;

      const rr = Math.sqrt(rp.mass) * 2;
      const dx = rp.x - px;
      const dy = rp.y - py;
      const touchDistSq = (pr + rr) * (pr + rr);
      if (dx * dx + dy * dy > touchDistSq) continue;

      if (pm >= rp.mass * ABSORB_RATIO) {
        // We absorb them: momentum conservation
        const tm = pm + rp.mass;
        this.player.vx = (this.player.vx * pm + rp.vx * rp.mass) / tm;
        this.player.vy = (this.player.vy * pm + rp.vy * rp.mass) / tm;
        this.player.mass = tm;
        this.absorbedPlayers.add(rp.id);
        this.net.sendAbsorbPlayer(rp.id);
      } else if (rp.mass >= pm * ABSORB_RATIO) {
        // They absorb us: game over
        this.phase = 'consumed';
        const tag = rp.id.slice(0, 6).toUpperCase();
        this.showEndScreen(false, `ABSORBED BY ${tag}`);
        break;
      }
    }
  }

  private showEndScreen(escaped: boolean, deathMessage?: string) {
    const mass = Math.floor(this.player.mass);
    const timeSurvived = Math.floor(this.gameTimer);
    const score = Math.floor(mass * (1 + this.gameTimer / 60));

    // Compute rank among all players (local + alive remotes)
    const allMasses: number[] = [this.player.mass];
    if (this.net) {
      for (const rp of this.net.otherPlayers.values()) {
        if (rp.phase === "alive") allMasses.push(rp.mass);
      }
    }
    allMasses.sort((a, b) => b - a);
    const rank = allMasses.indexOf(this.player.mass) + 1;
    const total = allMasses.length;

    // High score (localStorage)
    const HS_KEY = "omnivi_highscore";
    const prevBest = parseInt(localStorage.getItem(HS_KEY) ?? "0", 10);
    const isNewBest = score > prevBest;
    if (isNewBest) localStorage.setItem(HS_KEY, String(score));

    // Semi-transparent dark overlay
    const gw = this.scale.width;
    const gh = this.scale.height;
    const overlay = this.add.graphics().setScrollFactor(0).setDepth(25);
    overlay.fillStyle(0x000000, 0.65);
    overlay.fillRect(0, 0, gw, gh);

    if (escaped) {
      this.endText.setText("ESCAPED!").setColor("#00ffaa").setVisible(true);
    } else {
      const msg = deathMessage ?? "CONSUMED BY THE VOID";
      this.endText.setText(msg).setColor("#ff5500").setVisible(true);
    }

    const mins = Math.floor(timeSurvived / 60);
    const secs = timeSurvived % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    const rankStr = total > 1 ? `Rank  #${rank} / ${total}` : "";
    const bestStr = isNewBest ? "NEW HIGH SCORE!" : `Best: ${prevBest.toLocaleString()}`;

    const statsLines = [
      `Mass: ${mass.toLocaleString()}   Time: ${timeStr}   Score: ${score.toLocaleString()}`,
      rankStr,
      bestStr,
    ].filter(Boolean);

    this.statsText
      .setText(statsLines.join("\n"))
      .setColor(isNewBest ? "#ffdd00" : "#dddddd")
      .setVisible(true);

    this.restartText.setVisible(true);
    this.menuKeyText.setVisible(true);

    this.input.keyboard!.once("keydown-R", () => {
      this.scene.restart();
    });
    this.input.keyboard!.once("keydown-M", () => {
      this.scene.start("MainMenu");
    });
  }

  // ─── Phase HUD ─────────────────────────────────────────────────────────────
  private updatePhaseHUD() {
    if (this.phase === 'playing') {
      const remaining = SHRINK_START_DELAY - this.gameTimer;
      if (remaining <= 30) {
        this.phaseText
          .setText(`⚠  BIG SHRINK IN  ${remaining.toFixed(0)}s  ⚠`)
          .setColor("#ff8800");
      } else {
        this.phaseText.setText("");
      }
      return;
    }

    if (this.phase === 'shrinking') {
      if (this.escaping) {
        const t = this.time.now / 1000;
        const pulse = Math.sin(t * 6) > 0 ? "#00ffaa" : "#ffffff";
        this.phaseText
          .setText(`ESCAPING...  ${this.escapeTimer.toFixed(1)}s`)
          .setColor(pulse);
      } else if (this.disruptFlash > 0) {
        // phaseText already set by disruptEscape/warning — leave it
      } else {
        const distFromCenter = Math.hypot(
          this.player.x - WORLD_SIZE / 2,
          this.player.y - WORLD_SIZE / 2
        );
        const canEscape = distFromCenter >= ESCAPE_MIN_DIST;
        if (canEscape) {
          this.phaseText
            .setText("THE BIG SHRINK  |  Press  [E]  to ESCAPE")
            .setColor("#ffcc00");
        } else {
          this.phaseText
            .setText("THE BIG SHRINK  |  Move to the outer edge to escape")
            .setColor("#ff8800");
        }
      }
    }
  }

  // ─── Spatial-grid dust merging ─────────────────────────────────────────────
  private mergeDust() {
    const CELL = 40; // grid cell size — covers max small-dust diameter well
    const grid = new Map<number, DustParticle[]>();
    const cellKey = (cx: number, cy: number) => cx * 10000 + cy;
    const cellOf = (v: number) => Math.floor(v / CELL);

    for (const d of this.dust) {
      const key = cellKey(cellOf(d.x), cellOf(d.y));
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(d);
    }

    let anyMerged = false;
    for (const d of this.dust) {
      if (!d.active) continue;
      const cx = cellOf(d.x);
      const cy = cellOf(d.y);
      for (let nx = cx - 1; nx <= cx + 1; nx++) {
        for (let ny = cy - 1; ny <= cy + 1; ny++) {
          const bucket = grid.get(cellKey(nx, ny));
          if (!bucket) continue;
          for (const other of bucket) {
            if (other === d || !other.active) continue;
            const dx = other.x - d.x;
            const dy = other.y - d.y;
            const minDist = d.radius + other.radius;
            if (dx * dx + dy * dy < minDist * minDist) {
              // Larger absorbs smaller; ties go to d
              const bigger = d.mass >= other.mass ? d : other;
              const smaller = bigger === d ? other : d;
              const totalMass = bigger.mass + smaller.mass;
              bigger.vx = (bigger.vx * bigger.mass + smaller.vx * smaller.mass) / totalMass;
              bigger.vy = (bigger.vy * bigger.mass + smaller.vy * smaller.mass) / totalMass;
              bigger.x = (bigger.x * bigger.mass + smaller.x * smaller.mass) / totalMass;
              bigger.y = (bigger.y * bigger.mass + smaller.y * smaller.mass) / totalMass;
              bigger.mass = totalMass;
              smaller.active = false;
              anyMerged = true;
            }
          }
        }
      }
    }

    if (anyMerged) {
      this.dust = this.dust.filter(d => d.active);
    }

    // Respawn sparse ambient dust so the world stays populated
    while (this.dust.length < DUST_RESPAWN_MIN) {
      const x = Math.random() * WORLD_SIZE;
      const y = Math.random() * WORLD_SIZE;
      const mass = DUST_EMIT_MASS + Math.random() * 6;
      const speed = Math.random() * 20;
      const angle = Math.random() * Math.PI * 2;
      this.dust.push(new DustParticle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, mass));
    }
  }

  /** Graduate dust particles that have grown past the asteroid threshold. */
  private promoteDust() {
    const toPromote: DustParticle[] = [];
    this.dust = this.dust.filter(d => {
      if (d.mass >= ASTEROID_THRESHOLD) {
        toPromote.push(d);
        return false;
      }
      return true;
    });
    for (const d of toPromote) {
      this.asteroids.push(new Asteroid(d.x, d.y, d.vx, d.vy, d.mass));
    }
  }

  /** Each asteroid vacuums up overlapping dust via momentum-conserving absorption. */
  private asteroidAbsorbsDust() {
    let anyConsumed = false;
    for (const a of this.asteroids) {
      const ar = a.radius;
      for (const d of this.dust) {
        if (!d.active) continue;
        const dx = d.x - a.x;
        const dy = d.y - a.y;
        if (dx * dx + dy * dy < (ar + d.radius) * (ar + d.radius)) {
          const tm = a.mass + d.mass;
          a.vx = (a.vx * a.mass + d.vx * d.mass) / tm;
          a.vy = (a.vy * a.mass + d.vy * d.mass) / tm;
          a.x  = (a.x  * a.mass + d.x  * d.mass) / tm;
          a.y  = (a.y  * a.mass + d.y  * d.mass) / tm;
          a.mass = tm;
          d.active = false;
          anyConsumed = true;
        }
      }
    }
    if (anyConsumed) this.dust = this.dust.filter(d => d.active);
  }

  /** Larger asteroid merges with smaller on overlap (planet formation). */
  private mergeAsteroids() {
    let anyMerged = false;
    for (let i = 0; i < this.asteroids.length; i++) {
      const a = this.asteroids[i];
      if (!a.active) continue;
      for (let j = i + 1; j < this.asteroids.length; j++) {
        const b = this.asteroids[j];
        if (!b.active) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.radius + b.radius;
        if (dx * dx + dy * dy < minDist * minDist) {
          const bigger  = a.mass >= b.mass ? a : b;
          const smaller = bigger === a ? b : a;
          const tm = bigger.mass + smaller.mass;
          bigger.vx = (bigger.vx * bigger.mass + smaller.vx * smaller.mass) / tm;
          bigger.vy = (bigger.vy * bigger.mass + smaller.vy * smaller.mass) / tm;
          bigger.x  = (bigger.x  * bigger.mass + smaller.x  * smaller.mass) / tm;
          bigger.y  = (bigger.y  * bigger.mass + smaller.y  * smaller.mass) / tm;
          bigger.mass = tm;
          smaller.active = false;
          anyMerged = true;
        }
      }
    }
    if (anyMerged) this.asteroids = this.asteroids.filter(a => a.active);
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  private drawScene() {
    this.gfx.clear();

    // Draw black hole first (underneath everything)
    if (this.phase === 'shrinking' || this.phase === 'escaped' || this.phase === 'consumed') {
      this.drawBlackHole();
    }

    // ── Draw remote players (ghost players behind local) ─────────────────
    this.drawRemotePlayers();

    // ── Draw dust — color shifts from blue (tiny) to orange (medium) ────
    for (const d of this.dust) {
      const r = Math.max(1.5, d.radius);
      // t: 0 at mass=2 (dust), 1 at mass=ASTEROID_THRESHOLD
      const t = Math.min(1, Math.log(Math.max(1, d.mass / 2)) / Math.log(25));
      const ri = Math.round(0x88 + t * (0xff - 0x88));
      const gi = Math.round(0xaa + t * (0x55 - 0xaa));
      const bi = Math.round(0xff + t * (0x11 - 0xff));
      const color = (ri << 16) | (gi << 8) | bi;
      const alpha = 0.55 + t * 0.35;
      this.gfx.fillStyle(color, alpha);
      this.gfx.fillCircle(d.x, d.y, r);
    }

    // ── Draw asteroids — craggy polygons, gray-brown-white by mass ───────
    for (const a of this.asteroids) {
      this.drawAsteroid(a);
    }

    const { x, y, radius, rotation, mass, thrustingThisFrame } = this.player;

    // ── Escape aura (drawn behind player) ───────────────────────────────
    if (this.escaping) {
      this.drawEscapeAura(x, y, radius);
    }

    // ── Thrust exhaust flame ─────────────────────────────────────────────
    if (thrustingThisFrame) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const flameX = x - cos * radius;
      const flameY = y - sin * radius;
      this.gfx.fillStyle(0xff4400, 0.3);
      this.gfx.fillCircle(flameX, flameY, radius * 0.55);
      this.gfx.fillStyle(0xffee00, 0.8);
      this.gfx.fillCircle(flameX, flameY, radius * 0.25);
    }

    // ── Gravity well glow ────────────────────────────────────────────────
    this.gfx.fillStyle(0xffffff, 0.04);
    this.gfx.fillCircle(x, y, radius * 2.2);

    // ── Player body — color shifts blue → yellow → red with mass ─────────
    const t = Math.min(1, mass / 5000);
    const hue = (1 - t) * 0.65;
    const playerColor = Phaser.Display.Color.HSLToColor(hue, 0.9, 0.6).color;
    this.gfx.fillStyle(playerColor, 1);
    this.gfx.fillCircle(x, y, radius);

    this.gfx.lineStyle(Math.max(1, radius * 0.04), 0xffffff, 0.7);
    this.gfx.strokeCircle(x, y, radius);

    // ── Direction indicator ──────────────────────────────────────────────
    const tipLen = radius + 12;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    this.gfx.lineStyle(Math.max(1.5, radius * 0.06), 0xffffff, 0.9);
    this.gfx.lineBetween(
      x + cos * radius * 0.3,
      y + sin * radius * 0.3,
      x + cos * tipLen,
      y + sin * tipLen
    );
  }

  /** Animated black hole at world center. */
  private drawBlackHole() {
    const bx  = WORLD_SIZE / 2;
    const by  = WORLD_SIZE / 2;
    const bhR = massToRadius(this.bhMass);
    const t   = this.time.now / 1000;

    // Outer gravitational lensing rings (faint, decreasing brightness outward)
    const lensRadii = [4.0, 3.0, 2.2, 1.6];
    const lensAlpha = [0.02, 0.04, 0.06, 0.08];
    for (let i = 0; i < lensRadii.length; i++) {
      this.gfx.fillStyle(0xff6600, lensAlpha[i]);
      this.gfx.fillCircle(bx, by, bhR * lensRadii[i]);
    }

    // Accretion disk — swirling hotspots orbiting the BH
    const numSpots = 10;
    for (let i = 0; i < numSpots; i++) {
      const angle  = (i / numSpots) * Math.PI * 2 + t * (1.2 + i * 0.08);
      const arcR   = bhR * (1.15 + 0.3 * Math.sin(i * 1.7 + t * 0.5));
      const ax     = bx + Math.cos(angle) * arcR;
      const ay     = by + Math.sin(angle) * arcR;
      const brightness = 0.1 + 0.15 * Math.sin(t * 3 + i * 0.9);
      // Color cycles orange → white near center
      const spotHue = 0.04 + 0.04 * Math.sin(t + i);
      const spotColor = Phaser.Display.Color.HSLToColor(spotHue, 0.9, 0.55).color;
      this.gfx.fillStyle(spotColor, Math.max(0.05, brightness));
      this.gfx.fillCircle(ax, ay, bhR * 0.14);
    }

    // Photon sphere ring
    this.gfx.lineStyle(Math.max(2, bhR * 0.04), 0xff9900, 0.5 + 0.3 * Math.sin(t * 2));
    this.gfx.strokeCircle(bx, by, bhR * 1.1);

    // Event horizon — pure black
    this.gfx.fillStyle(0x000000, 1);
    this.gfx.fillCircle(bx, by, bhR);

    // Thin bright rim at event horizon edge
    this.gfx.lineStyle(Math.max(1.5, bhR * 0.03), 0xffcc44, 0.7);
    this.gfx.strokeCircle(bx, by, bhR);
  }

  /** Pulsing escape aura drawn around the player. */
  private drawEscapeAura(x: number, y: number, radius: number) {
    const t     = this.time.now / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 6);

    this.gfx.lineStyle(5 + pulse * 4, 0x00ffaa, 0.35 + pulse * 0.45);
    this.gfx.strokeCircle(x, y, radius * 1.6 + pulse * 10);

    this.gfx.lineStyle(2, 0xffffff, 0.5 + pulse * 0.4);
    this.gfx.strokeCircle(x, y, radius * 1.25 + pulse * 5);
  }

  /** Screen-space vignette + disruption flash (drawn to vignetteGfx). */
  private drawVignette() {
    this.vignetteGfx.clear();

    const gw = this.scale.width;
    const gh = this.scale.height;

    // Disruption flash (red) — shown for any disruption/warning
    if (this.disruptFlash > 0) {
      const alpha = Math.min(0.4, this.disruptFlash * 0.33);
      this.vignetteGfx.fillStyle(0xff2200, alpha);
      this.vignetteGfx.fillRect(0, 0, gw, gh);
      return;
    }

    if (this.phase !== 'shrinking') return;

    // Darkness creeps in as player approaches BH
    const distFromBH = Math.hypot(
      this.player.x - WORLD_SIZE / 2,
      this.player.y - WORLD_SIZE / 2
    );
    const bhR  = massToRadius(this.bhMass);
    const danger = Math.max(0, 1 - distFromBH / (bhR * 9));
    if (danger > 0) {
      this.vignetteGfx.fillStyle(0x000000, danger * 0.55);
      this.vignetteGfx.fillRect(0, 0, gw, gh);
    }
  }

  private drawAsteroid(a: Asteroid) {
    const r = a.radius;
    const n = ASTEROID_VERTICES;

    // Color: dark gray → brown → pale gold as mass grows (ASTEROID_THRESHOLD → PLANET_THRESHOLD)
    const t = Math.min(1, Math.log(Math.max(1, a.mass / ASTEROID_THRESHOLD)) / Math.log(PLANET_THRESHOLD / ASTEROID_THRESHOLD));
    const ri = Math.round(0x66 + t * (0xcc - 0x66));
    const gi = Math.round(0x55 + t * (0x99 - 0x55));
    const bi = Math.round(0x44 + t * (0x44 - 0x44));
    const fillColor = (ri << 16) | (gi << 8) | bi;

    // Draw filled polygon
    this.gfx.fillStyle(fillColor, 1);
    this.gfx.beginPath();
    for (let i = 0; i < n; i++) {
      const angle = a.rotation + (i / n) * Math.PI * 2;
      const vr = r * a.shapeOffsets[i];
      const vx = a.x + Math.cos(angle) * vr;
      const vy = a.y + Math.sin(angle) * vr;
      if (i === 0) this.gfx.moveTo(vx, vy);
      else         this.gfx.lineTo(vx, vy);
    }
    this.gfx.closePath();
    this.gfx.fillPath();

    // Craggy outline — brighter for larger bodies
    const outlineAlpha = 0.4 + t * 0.4;
    const outlineColor = t > 0.7 ? 0xffdd88 : 0xaaaaaa;
    this.gfx.lineStyle(Math.max(1, r * 0.06), outlineColor, outlineAlpha);
    this.gfx.beginPath();
    for (let i = 0; i < n; i++) {
      const angle = a.rotation + (i / n) * Math.PI * 2;
      const vr = r * a.shapeOffsets[i];
      const vx = a.x + Math.cos(angle) * vr;
      const vy = a.y + Math.sin(angle) * vr;
      if (i === 0) this.gfx.moveTo(vx, vy);
      else         this.gfx.lineTo(vx, vy);
    }
    this.gfx.closePath();
    this.gfx.strokePath();

    // Planet glow for large bodies
    if (a.mass >= PLANET_THRESHOLD) {
      this.gfx.fillStyle(0xffdd44, 0.06);
      this.gfx.fillCircle(a.x, a.y, r * 2.0);
    }
  }

  /** Render all remote players as tinted circles with mass labels. */
  private drawRemotePlayers() {
    if (!this.net) return;
    for (const [, rp] of this.net.otherPlayers) {
      if (rp.phase !== "alive") continue;
      const r = Math.sqrt(rp.mass) * 2; // massToRadius
      // Parse HSL color string into a hex int Phaser can use
      const color = parseHslColor(rp.color);

      // Subtle glow
      this.gfx.fillStyle(color, 0.08);
      this.gfx.fillCircle(rp.x, rp.y, r * 2.0);

      // Body
      this.gfx.fillStyle(color, 0.75);
      this.gfx.fillCircle(rp.x, rp.y, r);

      // Outline
      this.gfx.lineStyle(Math.max(1, r * 0.04), 0xffffff, 0.5);
      this.gfx.strokeCircle(rp.x, rp.y, r);

      // Thrust flash
      if (rp.isThrusting) {
        this.gfx.fillStyle(0xff6600, 0.35);
        this.gfx.fillCircle(rp.x, rp.y, r * 0.4);
      }

      // Escape aura
      if (rp.isEscaping) {
        this.gfx.lineStyle(3, 0x00ffaa, 0.4);
        this.gfx.strokeCircle(rp.x, rp.y, r * 1.5);
      }
    }
  }

  // ─── Minimap ───────────────────────────────────────────────────────────────
  private drawMinimap() {
    const gw = this.scale.width;
    const gh = this.scale.height;
    const MM_SIZE = 160;
    const MM_PAD  = 12;
    const mmX  = gw - MM_SIZE - MM_PAD;   // top-left of minimap in screen coords
    const mmY  = gh - MM_SIZE - MM_PAD;
    const sc   = MM_SIZE / WORLD_SIZE;     // world → minimap scale

    this.minimapGfx.clear();

    // Background
    this.minimapGfx.fillStyle(0x000818, 0.65);
    this.minimapGfx.fillRect(mmX, mmY, MM_SIZE, MM_SIZE);

    // Border
    this.minimapGfx.lineStyle(1, 0x334455, 0.9);
    this.minimapGfx.strokeRect(mmX, mmY, MM_SIZE, MM_SIZE);

    const wx = (wx: number) => mmX + wx * sc;
    const wy = (wy: number) => mmY + wy * sc;

    // Black hole at world center (visible during shrink phase)
    if (this.phase === 'shrinking' || this.phase === 'escaped' || this.phase === 'consumed') {
      const bhR = Math.max(3, Math.min(massToRadius(this.bhMass) * sc, 14));
      this.minimapGfx.fillStyle(0xff6600, 0.9);
      this.minimapGfx.fillCircle(wx(WORLD_SIZE / 2), wy(WORLD_SIZE / 2), bhR);
      this.minimapGfx.fillStyle(0x000000, 1);
      this.minimapGfx.fillCircle(wx(WORLD_SIZE / 2), wy(WORLD_SIZE / 2), bhR * 0.65);
    }

    // Asteroids — gray; planets — gold
    for (const a of this.asteroids) {
      const isPlanet = a.mass >= PLANET_THRESHOLD;
      this.minimapGfx.fillStyle(isPlanet ? 0xffdd88 : 0x778899, isPlanet ? 0.85 : 0.55);
      this.minimapGfx.fillCircle(wx(a.x), wy(a.y), isPlanet ? 3 : 1.5);
    }

    // Remote players — their hue-colored dots
    if (this.net) {
      for (const [, rp] of this.net.otherPlayers) {
        if (rp.phase !== "alive") continue;
        this.minimapGfx.fillStyle(parseHslColor(rp.color), 0.9);
        this.minimapGfx.fillCircle(wx(rp.x), wy(rp.y), 3);
      }
    }

    // Local player — bright white with cyan ring to distinguish
    this.minimapGfx.fillStyle(0xffffff, 1);
    this.minimapGfx.fillCircle(wx(this.player.x), wy(this.player.y), 3);
    this.minimapGfx.lineStyle(1.5, 0x00ffff, 0.9);
    this.minimapGfx.strokeCircle(wx(this.player.x), wy(this.player.y), 5);

    // "MAP" label at top-left corner of minimap
    // (skipped — minimalist look is cleaner)
  }

  // ─── Leaderboard ───────────────────────────────────────────────────────────
  private drawLeaderboard() {
    type Entry = { label: string; mass: number; isLocal: boolean };
    const entries: Entry[] = [
      { label: "YOU", mass: this.player.mass, isLocal: true },
    ];
    if (this.net) {
      for (const [id, rp] of this.net.otherPlayers) {
        if (rp.phase !== "alive") continue;
        entries.push({ label: id.slice(0, 6), mass: rp.mass, isLocal: false });
      }
    }

    entries.sort((a, b) => b.mass - a.mass);
    const top5 = entries.slice(0, 5);

    const lines: string[] = ["LEADERBOARD"];
    for (let i = 0; i < top5.length; i++) {
      const e = top5[i];
      const name = e.isLocal ? "[YOU]" : e.label;
      lines.push(`#${i + 1} ${name}  ${Math.floor(e.mass)}`);
    }

    this.leaderboardText.setText(lines.join("\n"));
  }

  shutdown() {
    this.net?.disconnect();
    this.net = null;
  }

  private drawGrid() {
    const gridSize = 200;
    this.gridGfx.lineStyle(1, 0x1a2a3a, 0.8);
    for (let gx = 0; gx <= WORLD_SIZE; gx += gridSize) {
      this.gridGfx.moveTo(gx, 0);
      this.gridGfx.lineTo(gx, WORLD_SIZE);
    }
    for (let gy = 0; gy <= WORLD_SIZE; gy += gridSize) {
      this.gridGfx.moveTo(0, gy);
      this.gridGfx.lineTo(WORLD_SIZE, gy);
    }
    this.gridGfx.strokePath();
  }

  changeScene() {
    this.scene.start("GameOver");
  }
}

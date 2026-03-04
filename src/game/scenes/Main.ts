import Phaser from "phaser";
import { EventBus } from "../EventBus";

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
const ABSORB_RATIO = 1.5;        // player must be this times larger to absorb
const DUST_RESPAWN_MIN = 150;    // respawn ambient dust when count falls below this

// ─── Gravity (Barnes-Hut) ───────────────────────────────────────────────────
const GRAVITY_G = 800;           // gravitational constant (tune for feel)
const GRAVITY_THETA = 0.5;       // Barnes-Hut approximation threshold
const GRAVITY_MIN_DIST_SQ = 900; // 30px — avoid singularity
const MAX_G_ACCEL = 500;         // px/s² cap (prevents lag-spike explosions)

function massToRadius(mass: number): number {
  return Math.sqrt(mass) * RADIUS_SCALE;
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

  // Rendering
  private gfx!: Phaser.GameObjects.Graphics;
  private gridGfx!: Phaser.GameObjects.Graphics;

  // HUD
  private massText!: Phaser.GameObjects.Text;

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private pointer!: Phaser.Input.Pointer;
  private mouseDown: boolean = false;
  private gamepad: Phaser.Input.Gamepad.Gamepad | null = null;

  // Input mode
  private useMouse: boolean = true;
  private useKeyboard: boolean = false;
  private useGamepad: boolean = false;

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

    // Player
    this.player = new Player(WORLD_SIZE / 2, WORLD_SIZE / 2, STARTING_MASS);

    // Seed initial dust scattered around the world
    for (let i = 0; i < INITIAL_DUST_COUNT; i++) {
      const x = Math.random() * WORLD_SIZE;
      const y = Math.random() * WORLD_SIZE;
      const mass = DUST_EMIT_MASS + Math.random() * 8;
      const speed = Math.random() * 15;
      const angle = Math.random() * Math.PI * 2;
      this.dust.push(new DustParticle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, mass));
    }

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
      .text(16, 120, "Mouse: point to aim  |  Click/Hold: thrust\nWASD / Arrow keys: rotate & thrust", {
        fontSize: "12px",
        color: "#aaaaaa",
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setScrollFactor(0)
      .setDepth(20);

    // Keyboard input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyW = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);

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

    EventBus.emit("current-scene-ready", this);
  }

  update(_time: number, delta: number) {
    const dt = Math.min(delta / 1000, 0.05); // cap at 50 ms to prevent lag-spike explosions

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

    // ── Gravity simulation (Barnes-Hut) ───────────────────────────────────────
    if (this.dust.length > 0) {
      const tree = new QuadNode(0, 0, WORLD_SIZE, WORLD_SIZE);
      for (const d of this.dust) tree.insert(d);

      const px = this.player.x;
      const py = this.player.y;
      const pm = this.player.mass;

      for (const d of this.dust) {
        // Gravity from other dust (Barnes-Hut O(n log n))
        let [ax, ay] = tree.accelAt(d.x, d.y, d, GRAVITY_THETA);

        // Gravity from player (the dominant gravity well)
        const dx = px - d.x;
        const dy = py - d.y;
        const dSq = Math.max(dx * dx + dy * dy, GRAVITY_MIN_DIST_SQ);
        const dist = Math.sqrt(dSq);
        const pa = GRAVITY_G * pm / dSq;
        ax += pa * dx / dist;
        ay += pa * dy / dist;

        // Cap magnitude to guard against lag spikes
        const mag = Math.hypot(ax, ay);
        if (mag > MAX_G_ACCEL) { ax = ax / mag * MAX_G_ACCEL; ay = ay / mag * MAX_G_ACCEL; }
        d.vx += ax * dt;
        d.vy += ay * dt;
      }
    }

    // ── Update dust ────────────────────────────────────────────────────
    for (const d of this.dust) {
      d.update(dt);
    }

    // ── Dust-to-dust merging (spatial grid, O(n)) ──────────────────────
    this.mergeDust();

    // ── Absorption: player absorbs dust particles ───────────────────────
    const pr = this.player.radius;
    const px = this.player.x;
    const py = this.player.y;
    let absorbed = false;
    for (const d of this.dust) {
      if (!d.active) continue;
      if (this.player.mass < d.mass * ABSORB_RATIO) continue; // too small to absorb this dust
      const dx = d.x - px;
      const dy = d.y - py;
      if (dx * dx + dy * dy < (pr + d.radius) * (pr + d.radius)) {
        this.player.mass += d.mass;
        d.active = false;
        absorbed = true;
      }
    }
    if (absorbed) {
      this.dust = this.dust.filter((d) => d.active);
    }

    // ── Camera: follow player with dynamic zoom ─────────────────────────
    // Zoom out as player grows: zoom = base / radius
    const targetZoom = Phaser.Math.Clamp(550 / this.player.radius, 0.15, 3);
    const currentZoom = this.cameras.main.zoom;
    const newZoom = Phaser.Math.Linear(currentZoom, targetZoom, 0.04);
    this.cameras.main.setZoom(newZoom);
    this.cameras.main.centerOn(this.player.x, this.player.y);

    // ── HUD ─────────────────────────────────────────────────────────────
    const speed = Math.hypot(this.player.vx, this.player.vy);
    const asteroidCount = this.dust.filter(d => d.mass >= 20).length;
    const dustCount = this.dust.length - asteroidCount;
    this.massText.setText(
      [
        `Mass:   ${Math.floor(this.player.mass)}`,
        `Radius: ${this.player.radius.toFixed(1)} px`,
        `Speed:  ${speed.toFixed(0)} px/s`,
        `Dust:   ${dustCount}  Rocks: ${asteroidCount}`,
        `Pos:    (${Math.floor(this.player.x)}, ${Math.floor(this.player.y)})`,
      ].join("\n")
    );

    // ── Render ──────────────────────────────────────────────────────────
    this.drawScene();
  }

  /**
   * Spatial-grid O(n) dust-to-dust collision and merging.
   * Particles that overlap combine via momentum conservation.
   * Also respawns ambient dust when the world gets sparse.
   */
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
              // Conservation of momentum
              bigger.vx = (bigger.vx * bigger.mass + smaller.vx * smaller.mass) / totalMass;
              bigger.vy = (bigger.vy * bigger.mass + smaller.vy * smaller.mass) / totalMass;
              // Center of mass position
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

  private drawScene() {
    this.gfx.clear();

    // ── Draw dust — color shifts from blue (tiny) to orange-red (asteroid) ──
    for (const d of this.dust) {
      const r = Math.max(1.5, d.radius);
      // t: 0 at mass=2 (dust), 1 at mass=100 (small asteroid)
      const t = Math.min(1, Math.log(Math.max(1, d.mass / 2)) / Math.log(50));
      const ri = Math.round(0x88 + t * (0xff - 0x88));
      const gi = Math.round(0xaa + t * (0x55 - 0xaa));
      const bi = Math.round(0xff + t * (0x11 - 0xff));
      const color = (ri << 16) | (gi << 8) | bi;
      const alpha = 0.55 + t * 0.35;
      this.gfx.fillStyle(color, alpha);
      this.gfx.fillCircle(d.x, d.y, r);
      if (d.mass > 20) {
        this.gfx.lineStyle(Math.max(1, r * 0.08), 0xffffff, 0.3);
        this.gfx.strokeCircle(d.x, d.y, r);
      }
    }

    const { x, y, radius, rotation, mass, thrustingThisFrame } = this.player;

    // ── Thrust exhaust flame ─────────────────────────────────────────────
    if (thrustingThisFrame) {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const flameX = x - cos * radius;
      const flameY = y - sin * radius;
      // Outer glow
      this.gfx.fillStyle(0xff4400, 0.3);
      this.gfx.fillCircle(flameX, flameY, radius * 0.55);
      // Inner core
      this.gfx.fillStyle(0xffee00, 0.8);
      this.gfx.fillCircle(flameX, flameY, radius * 0.25);
    }

    // ── Gravity well glow ────────────────────────────────────────────────
    this.gfx.fillStyle(0xffffff, 0.04);
    this.gfx.fillCircle(x, y, radius * 2.2);

    // ── Player body ──────────────────────────────────────────────────────
    // Color shifts from blue → yellow → red as mass grows
    const t = Math.min(1, mass / 5000);
    const hue = (1 - t) * 0.65; // 0.65 = blue, 0 = red
    const playerColor = Phaser.Display.Color.HSLToColor(hue, 0.9, 0.6).color;
    this.gfx.fillStyle(playerColor, 1);
    this.gfx.fillCircle(x, y, radius);

    // ── Outline ──────────────────────────────────────────────────────────
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

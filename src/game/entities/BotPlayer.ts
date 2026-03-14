import {
  massToRadius, WORLD_SIZE, DRAG, THRUST_MASS_COST,
  ABSORB_RATIO, BOT_THRUST, BOT_MAX_SPEED, BOT_DETECT_RANGE,
} from "../constants";
import type { DustParticle } from "./DustParticle";
import type { Player } from "./Player";

export class BotPlayer {
  x: number;
  y: number;
  vx: number = 0;
  vy: number = 0;
  mass: number;
  rotation: number = 0;
  color: number;
  name: string;
  active: boolean = true;
  thrustingThisFrame: boolean = false;

  private wanderTarget: { x: number; y: number } | null = null;
  private wanderCooldown: number = 0;

  constructor(x: number, y: number, mass: number, color: number, name: string) {
    this.x = x;
    this.y = y;
    this.mass = mass;
    this.color = color;
    this.name = name;
    this.rotation = Math.random() * Math.PI * 2;
  }

  get radius(): number {
    return massToRadius(this.mass);
  }

  /**
   * AI brain: choose a rotation target and set thrustingThisFrame.
   * Physics (velocity, position, drag) are updated after decision.
   */
  updateAI(dt: number, player: Player, dust: DustParticle[]) {
    this.thrustingThisFrame = false;

    const playerDist = Math.hypot(player.x - this.x, player.y - this.y);

    // ── 1. FLEE from player if they're big enough to eat us ──────────────
    if (player.mass >= this.mass * ABSORB_RATIO && playerDist < BOT_DETECT_RANGE) {
      this.rotation = Math.atan2(this.y - player.y, this.x - player.x);
      this.thrustingThisFrame = true;
      return;
    }

    // ── 2. HUNT player if we're big enough to eat them ───────────────────
    if (this.mass >= player.mass * ABSORB_RATIO && playerDist < BOT_DETECT_RANGE) {
      this.rotation = Math.atan2(player.y - this.y, player.x - this.x);
      this.thrustingThisFrame = true;
      return;
    }

    // ── 3. CHASE nearest dust ─────────────────────────────────────────────
    let nearestDust: DustParticle | null = null;
    let nearestDustDistSq = (BOT_DETECT_RANGE * 0.7) ** 2;
    for (const d of dust) {
      if (!d.active) continue;
      const dSq = (d.x - this.x) ** 2 + (d.y - this.y) ** 2;
      if (dSq < nearestDustDistSq) {
        nearestDustDistSq = dSq;
        nearestDust = d;
      }
    }
    if (nearestDust) {
      this.rotation = Math.atan2(nearestDust.y - this.y, nearestDust.x - this.x);
      this.thrustingThisFrame = true;
      return;
    }

    // ── 4. WANDER ─────────────────────────────────────────────────────────
    this.wanderCooldown -= dt;
    if (this.wanderCooldown <= 0 || !this.wanderTarget) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = 400 + Math.random() * 800;
      this.wanderTarget = {
        x: Math.max(200, Math.min(WORLD_SIZE - 200, this.x + Math.cos(angle) * dist)),
        y: Math.max(200, Math.min(WORLD_SIZE - 200, this.y + Math.sin(angle) * dist)),
      };
      this.wanderCooldown = 3 + Math.random() * 5;
    }
    const tdx = this.wanderTarget.x - this.x;
    const tdy = this.wanderTarget.y - this.y;
    if (Math.hypot(tdx, tdy) > 60) {
      this.rotation = Math.atan2(tdy, tdx);
      this.thrustingThisFrame = true;
    } else {
      this.wanderTarget = null;
    }
  }

  /** Apply thrust + drag + position update after AI decision. */
  updatePhysics(dt: number) {
    if (this.thrustingThisFrame && this.mass > 15) {
      const cos = Math.cos(this.rotation);
      const sin = Math.sin(this.rotation);
      this.vx += cos * BOT_THRUST * dt;
      this.vy += sin * BOT_THRUST * dt;
      const speed = Math.hypot(this.vx, this.vy);
      if (speed > BOT_MAX_SPEED) {
        this.vx = (this.vx / speed) * BOT_MAX_SPEED;
        this.vy = (this.vy / speed) * BOT_MAX_SPEED;
      }
      this.mass = Math.max(15, this.mass - THRUST_MASS_COST);
    }
    const dragFactor = Math.pow(DRAG, dt * 60);
    this.vx *= dragFactor;
    this.vy *= dragFactor;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Boundary bounce
    const r = this.radius;
    if (this.x < r) { this.x = r; this.vx =  Math.abs(this.vx) * 0.5; }
    if (this.x > WORLD_SIZE - r) { this.x = WORLD_SIZE - r; this.vx = -Math.abs(this.vx) * 0.5; }
    if (this.y < r) { this.y = r; this.vy =  Math.abs(this.vy) * 0.5; }
    if (this.y > WORLD_SIZE - r) { this.y = WORLD_SIZE - r; this.vy = -Math.abs(this.vy) * 0.5; }
  }
}

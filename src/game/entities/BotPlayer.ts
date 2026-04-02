import {
  massToRadius, WORLD_SIZE, THRUST_MASS_COST_PCT,
  ABSORB_RATIO, BOT_THRUST, BOT_MAX_SPEED, BOT_DETECT_RANGE,
  BOOST_IMPULSE, BOOST_MASS_COST_PCT, BOOST_COOLDOWN, GamePhase,
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
  /** True when the bot fires a boost burst this frame. */
  boostThisFrame: boolean = false;
  /** Seconds until bot can boost again. */
  boostCooldown: number = 0;

  private wanderTarget: { x: number; y: number } | null = null;
  private wanderCooldown: number = 0;

  constructor(x: number, y: number, mass: number, color: number, name: string) {
    this.x = x;
    this.y = y;
    this.mass = mass;
    this.color = color;
    this.name = name;
    this.rotation = Math.random() * Math.PI * 2;
    // Stagger boost cooldowns so bots don't all boost simultaneously
    this.boostCooldown = Math.random() * BOOST_COOLDOWN;
  }

  get radius(): number {
    return massToRadius(this.mass);
  }

  /**
   * AI brain: choose a rotation target and set thrustingThisFrame.
   * Physics (velocity, position, mass cost) are updated after decision.
   *
   * Priority order:
   *  1. Flee Black Hole (shrinking phase, within danger radius)
   *  2. Flee player (player can eat us)
   *  3. Hunt nearest edible target (bot or player)
   *  4. Chase nearest dust
   *  5. Wander
   */
  updateAI(
    dt: number,
    player: Player,
    dust: DustParticle[],
    phase: GamePhase,
    bhX: number,
    bhY: number,
    bhMass: number,
    bots: BotPlayer[],
  ) {
    this.thrustingThisFrame = false;
    this.boostThisFrame = false;
    this.boostCooldown = Math.max(0, this.boostCooldown - dt);

    const bhRadius = massToRadius(bhMass);
    // Distance at which bot starts fleeing BH (2× BH radius or 600px, whichever is larger)
    const bhDangerDist = Math.max(bhRadius * 2, 600);

    // ── 1. FLEE Black Hole (shrinking phase) ──────────────────────────────
    if (phase === 'shrinking') {
      const ddx = this.x - bhX;
      const ddy = this.y - bhY;
      const bhDist = Math.hypot(ddx, ddy);
      if (bhDist < bhDangerDist) {
        this.rotation = Math.atan2(ddy, ddx); // away from BH center
        this.thrustingThisFrame = true;
        // Boost when BH is very close (< 1.3× danger zone) and cooldown ready
        if (bhDist < bhDangerDist * 1.3 && this.boostCooldown <= 0 && this.mass > 100) {
          this.boostThisFrame = true;
          this.boostCooldown = BOOST_COOLDOWN;
        }
        return;
      }
    }

    const playerDist = Math.hypot(player.x - this.x, player.y - this.y);

    // ── 2. FLEE from player if they're big enough to eat us ──────────────
    if (player.mass >= this.mass * ABSORB_RATIO && playerDist < BOT_DETECT_RANGE) {
      this.rotation = Math.atan2(this.y - player.y, this.x - player.x);
      this.thrustingThisFrame = true;
      // Boost when player is bearing down on us (< 50% detect range)
      if (playerDist < BOT_DETECT_RANGE * 0.5 && this.boostCooldown <= 0 && this.mass > 100) {
        this.boostThisFrame = true;
        this.boostCooldown = BOOST_COOLDOWN;
      }
      return;
    }

    // ── 3. HUNT nearest edible target (player or other bot) ──────────────
    let bestTargetX = 0;
    let bestTargetY = 0;
    let bestTargetDist = Infinity;
    let foundTarget = false;

    // Check player as prey
    if (this.mass >= player.mass * ABSORB_RATIO && playerDist < BOT_DETECT_RANGE) {
      bestTargetX = player.x;
      bestTargetY = player.y;
      bestTargetDist = playerDist;
      foundTarget = true;
    }

    // Check other bots as prey — prefer closer targets
    for (const other of bots) {
      if (!other.active || other === this) continue;
      if (this.mass < other.mass * ABSORB_RATIO) continue;
      const d = Math.hypot(other.x - this.x, other.y - this.y);
      if (d < BOT_DETECT_RANGE && d < bestTargetDist) {
        bestTargetX = other.x;
        bestTargetY = other.y;
        bestTargetDist = d;
        foundTarget = true;
      }
    }

    if (foundTarget) {
      this.rotation = Math.atan2(bestTargetY - this.y, bestTargetX - this.x);
      this.thrustingThisFrame = true;
      // Boost when prey is within 65% of detect range (closing in for kill)
      if (bestTargetDist < BOT_DETECT_RANGE * 0.65 && this.boostCooldown <= 0 && this.mass > 100) {
        this.boostThisFrame = true;
        this.boostCooldown = BOOST_COOLDOWN;
      }
      return;
    }

    // ── 4. CHASE nearest dust ─────────────────────────────────────────────
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

    // ── 5. WANDER ─────────────────────────────────────────────────────────
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

  /** Apply thrust + boost + position update after AI decision. */
  updatePhysics(dt: number) {
    if (this.thrustingThisFrame && this.mass > 15) {
      const cos = Math.cos(this.rotation);
      const sin = Math.sin(this.rotation);
      this.vx += cos * BOT_THRUST * dt;
      this.vy += sin * BOT_THRUST * dt;
      this.mass = Math.max(15, this.mass - this.mass * THRUST_MASS_COST_PCT);
    }
    if (this.boostThisFrame && this.mass > 100) {
      const cos = Math.cos(this.rotation);
      const sin = Math.sin(this.rotation);
      const massCost = Math.max(15, this.mass * BOOST_MASS_COST_PCT);
      this.mass = Math.max(15, this.mass - massCost);
      this.vx += cos * BOOST_IMPULSE;
      this.vy += sin * BOOST_IMPULSE;
    }
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > BOT_MAX_SPEED) {
      this.vx = (this.vx / speed) * BOT_MAX_SPEED;
      this.vy = (this.vy / speed) * BOT_MAX_SPEED;
    }
    // No drag in space
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // Boundary bounce (elastic)
    const r = this.radius;
    if (this.x < r) { this.x = r; this.vx =  Math.abs(this.vx); }
    if (this.x > WORLD_SIZE - r) { this.x = WORLD_SIZE - r; this.vx = -Math.abs(this.vx); }
    if (this.y < r) { this.y = r; this.vy =  Math.abs(this.vy); }
    if (this.y > WORLD_SIZE - r) { this.y = WORLD_SIZE - r; this.vy = -Math.abs(this.vy); }
  }
}

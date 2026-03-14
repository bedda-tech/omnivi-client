import {
  massToRadius, WORLD_SIZE, DRAG, MAX_SPEED,
  THRUST_FORCE, THRUST_MASS_COST, DUST_EMIT_MASS, STARTING_MASS,
} from "../constants";

export class Player {
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

    // Accelerate forward — bigger players have weaker thrust (skill expression)
    const thrustScale = Math.sqrt(STARTING_MASS / this.mass);
    this.vx += cos * THRUST_FORCE * thrustScale * dt;
    this.vy += sin * THRUST_FORCE * thrustScale * dt;

    // Clamp speed
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > MAX_SPEED) {
      this.vx = (this.vx / speed) * MAX_SPEED;
      this.vy = (this.vy / speed) * MAX_SPEED;
    }

    // Expel mass as dust from the back of the player (proportional to size)
    const massLost = Math.max(THRUST_MASS_COST, this.mass * 0.001);
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

import { massToRadius, WORLD_SIZE } from "../constants";

export class DustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  active: boolean = true;
  /** True if ejected by local player thrust; immune to player absorption for 500ms */
  playerEjected: boolean = false;
  playerImmuneUntil: number = 0;

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

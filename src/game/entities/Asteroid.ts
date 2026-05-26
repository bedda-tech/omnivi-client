import { massToRadius, WORLD_SIZE, ASTEROID_VERTICES } from "../constants";

export class Asteroid {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  rotation: number;
  rotationSpeed: number;  // rad/s
  active: boolean = true;
  /** Non-null when this asteroid was formed by the server; required for server-auth absorption. */
  serverId: string | null = null;
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
    // No drag in space — asteroid coasts freely
    // Elastic bounce at world edges
    const r = this.radius;
    if (this.x < r) { this.x = r; this.vx = Math.abs(this.vx); }
    if (this.x > WORLD_SIZE - r) { this.x = WORLD_SIZE - r; this.vx = -Math.abs(this.vx); }
    if (this.y < r) { this.y = r; this.vy = Math.abs(this.vy); }
    if (this.y > WORLD_SIZE - r) { this.y = WORLD_SIZE - r; this.vy = -Math.abs(this.vy); }
  }
}

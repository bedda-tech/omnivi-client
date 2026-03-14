import { GRAVITY_G, GRAVITY_MIN_DIST_SQ } from "../constants";
import type { DustParticle } from "./DustParticle";

export class QuadNode {
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

import {
  COLLISION_RESTITUTION, COLLISION_SEPARATION,
  FRAGMENT_KE_THRESHOLD, FRAGMENT_MASS_PCT, FRAGMENT_COUNT,
  ASTEROID_THRESHOLD, ABSORB_RATIO,
  DUST_RESPAWN_MIN, DUST_EMIT_MASS, WORLD_SIZE,
} from "../constants";
import { DustParticle } from "../entities/DustParticle";
import { Asteroid } from "../entities/Asteroid";

export interface CollisionBody {
  x: number; y: number;
  vx: number; vy: number;
  mass: number; radius: number;
}

export interface DebrisItem {
  x: number; y: number;
  vx: number; vy: number;
  mass: number;
}

/**
 * Pure physics utilities — no Phaser or scene dependencies.
 * All methods are static; no instance needed.
 */
export class PhysicsManager {
  /**
   * Resolve an elastic collision between two circular bodies.
   * Modifies a and b positions/velocities in-place.
   * Returns debris particles to spawn (empty if no fragmentation).
   */
  static resolveElasticCollision(a: CollisionBody, b: CollisionBody): DebrisItem[] {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) return [];

    const nx = dx / dist;
    const ny = dy / dist;

    const overlap = (a.radius + b.radius) - dist;
    if (overlap > 0) {
      const totalInvMass = 1 / a.mass + 1 / b.mass;
      const sepA = (overlap * COLLISION_SEPARATION) * (1 / a.mass) / totalInvMass;
      const sepB = (overlap * COLLISION_SEPARATION) * (1 / b.mass) / totalInvMass;
      a.x -= nx * sepA; a.y -= ny * sepA;
      b.x += nx * sepB; b.y += ny * sepB;
    }

    const dvx = a.vx - b.vx;
    const dvy = a.vy - b.vy;
    const vRelN = dvx * nx + dvy * ny;
    if (vRelN <= 0) return [];

    const j = (1 + COLLISION_RESTITUTION) * vRelN / (1 / a.mass + 1 / b.mass);
    a.vx -= (j / a.mass) * nx; a.vy -= (j / a.mass) * ny;
    b.vx += (j / b.mass) * nx; b.vy += (j / b.mass) * ny;

    const debris: DebrisItem[] = [];
    const reducedMass = (a.mass * b.mass) / (a.mass + b.mass);
    const impactKE = 0.5 * reducedMass * vRelN * vRelN;

    if (impactKE > FRAGMENT_KE_THRESHOLD) {
      const energyScale = Math.min(1, impactKE / (FRAGMENT_KE_THRESHOLD * 5));
      const contactX = a.x + nx * a.radius;
      const contactY = a.y + ny * a.radius;

      for (const body of [a, b]) {
        if (body.mass < 30) continue;
        const shedMass = body.mass * FRAGMENT_MASS_PCT * energyScale;
        const perPiece = shedMass / FRAGMENT_COUNT;
        if (perPiece < 1) continue;
        body.mass -= shedMass;

        for (let k = 0; k < FRAGMENT_COUNT; k++) {
          const angle = Math.atan2(body.y - contactY, body.x - contactX) + (Math.random() - 0.5) * Math.PI;
          const speed = 80 + Math.random() * 200 * energyScale;
          debris.push({
            x: contactX + Math.cos(angle) * (body.radius * 0.3),
            y: contactY + Math.sin(angle) * (body.radius * 0.3),
            vx: body.vx + Math.cos(angle) * speed,
            vy: body.vy + Math.sin(angle) * speed,
            mass: perPiece,
          });
        }
      }
    }

    return debris;
  }

  /**
   * Merge overlapping dust particles using a spatial grid.
   * Respawns sparse ambient dust.
   * Returns the new dust array.
   */
  static mergeDust(dust: DustParticle[]): DustParticle[] {
    const CELL = 40;
    const grid = new Map<number, DustParticle[]>();
    const cellKey = (cx: number, cy: number) => cx * 10000 + cy;
    const cellOf  = (v: number) => Math.floor(v / CELL);

    for (const d of dust) {
      const key = cellKey(cellOf(d.x), cellOf(d.y));
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(d);
    }

    let anyMerged = false;
    for (const d of dust) {
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
              const bigger  = d.mass >= other.mass ? d : other;
              const smaller = bigger === d ? other : d;
              const totalMass = bigger.mass + smaller.mass;
              bigger.vx = (bigger.vx * bigger.mass + smaller.vx * smaller.mass) / totalMass;
              bigger.vy = (bigger.vy * bigger.mass + smaller.vy * smaller.mass) / totalMass;
              bigger.x  = (bigger.x  * bigger.mass + smaller.x  * smaller.mass) / totalMass;
              bigger.y  = (bigger.y  * bigger.mass + smaller.y  * smaller.mass) / totalMass;
              bigger.mass = totalMass;
              smaller.active = false;
              anyMerged = true;
            }
          }
        }
      }
    }

    let result = anyMerged ? dust.filter(d => d.active) : dust;

    while (result.length < DUST_RESPAWN_MIN) {
      const x = Math.random() * WORLD_SIZE;
      const y = Math.random() * WORLD_SIZE;
      const mass = DUST_EMIT_MASS + Math.random() * 6;
      const speed = Math.random() * 20;
      const angle = Math.random() * Math.PI * 2;
      result.push(new DustParticle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, mass));
    }

    return result;
  }

  /**
   * Graduate dust particles that have grown past ASTEROID_THRESHOLD into Asteroids.
   * Returns updated { dust, asteroids } arrays.
   */
  static promoteDust(
    dust: DustParticle[],
    asteroids: Asteroid[],
  ): { dust: DustParticle[]; asteroids: Asteroid[] } {
    const toPromote: DustParticle[] = [];
    const newDust = dust.filter(d => {
      if (d.mass >= ASTEROID_THRESHOLD) { toPromote.push(d); return false; }
      return true;
    });
    const newAsteroids = [
      ...asteroids,
      ...toPromote.map(d => new Asteroid(d.x, d.y, d.vx, d.vy, d.mass)),
    ];
    return { dust: newDust, asteroids: newAsteroids };
  }

  /**
   * Each asteroid vacuums up overlapping dust.
   * Returns the filtered dust array (consumed dust removed).
   */
  static asteroidAbsorbsDust(dust: DustParticle[], asteroids: Asteroid[]): DustParticle[] {
    let anyConsumed = false;
    for (const a of asteroids) {
      const ar = a.radius;
      for (const d of dust) {
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
    return anyConsumed ? dust.filter(d => d.active) : dust;
  }

  /**
   * Merge overlapping asteroids (larger absorbs smaller; similar-size → elastic bounce).
   * Returns { asteroids, debris } where debris are fragments to spawn as dust.
   */
  static mergeAsteroids(
    asteroids: Asteroid[],
  ): { asteroids: Asteroid[]; debris: DebrisItem[] } {
    let anyMerged = false;
    const debris: DebrisItem[] = [];

    for (let i = 0; i < asteroids.length; i++) {
      const a = asteroids[i];
      if (!a.active) continue;
      for (let j = i + 1; j < asteroids.length; j++) {
        const b = asteroids[j];
        if (!b.active) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.radius + b.radius;
        if (dx * dx + dy * dy >= minDist * minDist) continue;

        const bigger  = a.mass >= b.mass ? a : b;
        const smaller = bigger === a ? b : a;

        if (bigger.mass >= smaller.mass * ABSORB_RATIO) {
          const tm = bigger.mass + smaller.mass;
          bigger.vx = (bigger.vx * bigger.mass + smaller.vx * smaller.mass) / tm;
          bigger.vy = (bigger.vy * bigger.mass + smaller.vy * smaller.mass) / tm;
          bigger.x  = (bigger.x  * bigger.mass + smaller.x  * smaller.mass) / tm;
          bigger.y  = (bigger.y  * bigger.mass + smaller.y  * smaller.mass) / tm;
          bigger.mass = tm;
          smaller.active = false;
          anyMerged = true;
        } else {
          const aBody: CollisionBody = { x: a.x, y: a.y, vx: a.vx, vy: a.vy, mass: a.mass, radius: a.radius };
          const bBody: CollisionBody = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, mass: b.mass, radius: b.radius };
          const frags = PhysicsManager.resolveElasticCollision(aBody, bBody);
          a.x = aBody.x; a.y = aBody.y; a.vx = aBody.vx; a.vy = aBody.vy; a.mass = aBody.mass;
          b.x = bBody.x; b.y = bBody.y; b.vx = bBody.vx; b.vy = bBody.vy; b.mass = bBody.mass;
          debris.push(...frags);
        }
      }
    }

    return { asteroids: anyMerged ? asteroids.filter(a => a.active) : asteroids, debris };
  }
}

import { describe, it, expect } from "vitest";
import { PhysicsManager, type CollisionBody } from "./PhysicsManager";
import { FRAGMENT_COUNT } from "../constants";

function body(overrides: Partial<CollisionBody> = {}): CollisionBody {
  return { x: 0, y: 0, vx: 0, vy: 0, mass: 100, radius: 10, ...overrides };
}

describe("PhysicsManager.resolveElasticCollision", () => {
  it("does not fragment on a gentle graze (below KE threshold)", () => {
    const a = body({ x: 0, vx: 5, mass: 100, radius: 10 });
    const b = body({ x: 19, vx: -5, mass: 100, radius: 10 });
    const debris = PhysicsManager.resolveElasticCollision(a, b);
    expect(debris).toHaveLength(0);
  });

  it("sheds FRAGMENT_COUNT debris pieces per body on a high-energy impact", () => {
    // Large masses + high closing speed -> reduced_mass * vRel^2 / 2 comfortably exceeds
    // FRAGMENT_KE_THRESHOLD (5e6), and both bodies are well above the 30-mass fragmentation floor.
    const a = body({ x: 0, vx: 400, mass: 500, radius: 20 });
    const b = body({ x: 39, vx: -400, mass: 500, radius: 20 });
    const debris = PhysicsManager.resolveElasticCollision(a, b);
    expect(debris.length).toBe(FRAGMENT_COUNT * 2);
  });

  it("reduces each body's mass by the shed debris mass", () => {
    const a = body({ x: 0, vx: 400, mass: 500, radius: 20 });
    const b = body({ x: 39, vx: -400, mass: 500, radius: 20 });
    const massBefore = a.mass + b.mass;
    const debris = PhysicsManager.resolveElasticCollision(a, b);
    const shed = debris.reduce((sum, d) => sum + d.mass, 0);
    expect(a.mass + b.mass + shed).toBeCloseTo(massBefore, 5);
  });

  it("never fragments a body below the 30-mass floor", () => {
    const a = body({ x: 0, vx: 400, mass: 20, radius: 5 });
    const b = body({ x: 9, vx: -400, mass: 500, radius: 20 });
    const debris = PhysicsManager.resolveElasticCollision(a, b);
    // Only `b` (mass 500) can shed debris; `a` is below the 30-mass fragmentation floor.
    expect(debris.length).toBe(FRAGMENT_COUNT);
  });

  it("skips separating/impulse work entirely when bodies are already moving apart", () => {
    const a = body({ x: 0, vx: -10, mass: 100, radius: 10 });
    const b = body({ x: 15, vx: 10, mass: 100, radius: 10 });
    const debris = PhysicsManager.resolveElasticCollision(a, b);
    expect(debris).toHaveLength(0);
    expect(a.vx).toBe(-10);
    expect(b.vx).toBe(10);
  });
});

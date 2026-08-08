import { describe, it, expect } from "vitest";
import { Player } from "./Player";
import { THRUST_MASS_COST_PCT, STARTING_MASS } from "../constants";

describe("Player.applyThrust", () => {
  it("costs THRUST_MASS_COST_PCT of current mass per tick", () => {
    const p = new Player(0, 0, STARTING_MASS);
    p.applyThrust(1 / 60);
    expect(p.mass).toBeCloseTo(STARTING_MASS * (1 - THRUST_MASS_COST_PCT), 5);
  });

  it("never drops mass below the 15 floor", () => {
    const p = new Player(0, 0, 15.01);
    p.applyThrust(1 / 60);
    expect(p.mass).toBeGreaterThanOrEqual(15);
  });

  it("refuses to thrust at or below the 15-mass floor", () => {
    const p = new Player(0, 0, 15);
    const result = p.applyThrust(1 / 60);
    expect(result).toBeNull();
    expect(p.mass).toBe(15);
  });

  it("costs proportionally more mass for a larger player (same percentage, bigger absolute loss)", () => {
    const small = new Player(0, 0, 1000);
    const big = new Player(0, 0, 10000);
    small.applyThrust(1 / 60);
    big.applyThrust(1 / 60);
    const smallLoss = 1000 - small.mass;
    const bigLoss = 10000 - big.mass;
    expect(bigLoss).toBeCloseTo(smallLoss * 10, 5);
  });
});

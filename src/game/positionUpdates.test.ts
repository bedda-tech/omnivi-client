import { describe, it, expect } from "vitest";
import { applyPositionUpdates } from "./NetworkManager";
import type { RemotePlayer, PositionUpdate } from "./NetworkManager";

function player(id: string, over: Partial<RemotePlayer> = {}): RemotePlayer {
  return {
    id,
    name: `Pilot-${id}`,
    x: 0, y: 0, vx: 0, vy: 0,
    mass: 1000,
    color: "hsl(200,80%,60%)",
    isThrusting: false,
    isEscaping: false,
    phase: "alive",
    tier: 1,
    buyInMass: 1000,
    kills: 0,
    isSpawnProtected: false,
    isShielded: false,
    isTestnetTier: false,
    isHunting: false,
    isFragmenting: false,
    isCloaked: false,
    ...over,
  };
}

function upd(id: string, over: Partial<PositionUpdate> = {}): PositionUpdate {
  return { id, x: 10, y: 20, vx: 3, vy: 4, mass: 1500, ...over };
}

describe("applyPositionUpdates", () => {
  it("applies motion fields onto a known player", () => {
    const players = new Map([["a", player("a")]]);

    expect(applyPositionUpdates(players, [upd("a")])).toBe(1);

    const a = players.get("a")!;
    expect(a).toMatchObject({ x: 10, y: 20, vx: 3, vy: 4, mass: 1500 });
  });

  it("leaves the slow-changing schema fields alone", () => {
    // The culled message carries motion only; name/colour/phase/ability flags stay with
    // the schema patch, so a batch must never blank them.
    const players = new Map([["a", player("a", { name: "Nova", isShielded: true, phase: "alive" })]]);

    applyPositionUpdates(players, [upd("a")]);

    const a = players.get("a")!;
    expect(a.name).toBe("Nova");
    expect(a.isShielded).toBe(true);
    expect(a.color).toBe("hsl(200,80%,60%)");
  });

  it("ignores ids it has no schema record for", () => {
    // players.onAdd owns creation — a player built from motion fields alone would
    // render nameless and colourless until the next patch.
    const players = new Map([["a", player("a")]]);

    expect(applyPositionUpdates(players, [upd("ghost")])).toBe(0);
    expect(players.size).toBe(1);
    expect(players.has("ghost")).toBe(false);
  });

  it("never removes players missing from a batch", () => {
    // Absence means "outside VIEW_RADIUS", not "gone". Removal is players.onRemove's job.
    const players = new Map([["a", player("a")], ["b", player("b", { x: 99, y: 99 })]]);

    applyPositionUpdates(players, [upd("a")]);

    expect(players.size).toBe(2);
    expect(players.get("b")).toMatchObject({ x: 99, y: 99 });
  });

  it("drops non-finite positions instead of poisoning the render lerp", () => {
    // RemotePlayerManager lerps `renderX += (target - renderX) * a`, so one NaN sticks
    // to that player forever.
    const players = new Map([["a", player("a", { x: 5, y: 6 })]]);

    expect(applyPositionUpdates(players, [upd("a", { x: NaN, y: 20 })])).toBe(0);
    expect(players.get("a")).toMatchObject({ x: 5, y: 6 });

    expect(applyPositionUpdates(players, [upd("a", { y: Infinity })])).toBe(0);
    expect(players.get("a")).toMatchObject({ x: 5, y: 6 });
  });

  it("keeps the last good velocity and mass when those fields are junk", () => {
    const players = new Map([["a", player("a", { vx: 1, vy: 2, mass: 900 })]]);

    expect(applyPositionUpdates(players, [upd("a", { vx: NaN, vy: NaN, mass: NaN })])).toBe(1);

    const a = players.get("a")!;
    expect(a).toMatchObject({ x: 10, y: 20, vx: 1, vy: 2, mass: 900 });
  });

  it("counts only what it applied across a mixed batch", () => {
    const players = new Map([["a", player("a")], ["b", player("b")]]);

    const applied = applyPositionUpdates(players, [
      upd("a"),
      upd("ghost"),
      upd("b", { x: NaN }),
    ]);

    expect(applied).toBe(1);
  });

  it("tolerates a missing or malformed payload", () => {
    const players = new Map([["a", player("a")]]);

    expect(applyPositionUpdates(players, undefined as unknown as PositionUpdate[])).toBe(0);
    expect(applyPositionUpdates(players, [null as unknown as PositionUpdate])).toBe(0);
    expect(applyPositionUpdates(players, [])).toBe(0);
    expect(players.get("a")).toMatchObject({ x: 0, y: 0 });
  });
});

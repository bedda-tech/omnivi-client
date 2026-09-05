/**
 * Wire-format compatibility test: live server encoder ⇄ this client's decoder.
 *
 * WHY THIS EXISTS. The server encodes room state with `@colyseus/schema` 4.x (pulled in
 * by `@colyseus/core` 0.17.x); this client decodes it with `@colyseus/schema` 3.x (pulled
 * in by `colyseus.js` 0.16.22 — the newest published client SDK, since no 0.17 client has
 * shipped). That is a major-version skew across the binary serializer, and nothing else in
 * either repo exercises the pairing: the server's unit tests only encode, and the client's
 * only test pure math. A silent decode drift in a game where mass *is* money would corrupt
 * balances rather than throw, so this test pins the contract against a real connection.
 *
 * It joins with `practice: true`, which makes `OmniviRoom.onJoin` skip all wallet/stake
 * verification, and which `gameServer.define("omnivi", …).filterBy(["practice","testnet"])`
 * isolates into its own room instance — so running this never touches a live staked round
 * or the testnet-points ledger.
 *
 * The whole suite skips itself when no server is listening, so `npm test` stays green
 * without one. Override the target with OMNIVI_HTTP_URL / OMNIVI_SERVER_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client, getStateCallbacks, type Room } from "colyseus.js";
import { WORLD_SIZE } from "./constants";

const HTTP_URL = process.env.OMNIVI_HTTP_URL ?? "http://localhost:8000";
const WS_URL = process.env.OMNIVI_SERVER_URL ?? "ws://localhost:8000";

/** Tier used for the probe. Must stay in sync with the server's TIER_START_MASS. */
const PROBE_TIER = 1;
const PROBE_TIER_START_MASS = 1000;

/** Every field declared on the server's PlayerState, with its decoded JS type. */
const PLAYER_FIELD_TYPES: Record<string, "string" | "number" | "boolean"> = {
  id: "string",
  name: "string",
  x: "number",
  y: "number",
  vx: "number",
  vy: "number",
  mass: "number",
  color: "string",
  isThrusting: "boolean",
  isEscaping: "boolean",
  phase: "string",
  tier: "number",
  buyInMass: "number",
  kills: "number",
  elo: "number",
  isBot: "boolean",
  isSpawnProtected: "boolean",
  isShielded: "boolean",
  isFragmenting: "boolean",
  isTestnetTier: "boolean",
  isHunting: "boolean",
};

/** Every primitive field declared on the server's GameState root. */
const GAME_FIELD_TYPES: Record<string, "string" | "number"> = {
  phase: "string",
  shrinkTimer: "number",
  bhMass: "number",
  bhX: "number",
  bhY: "number",
  lobbyCountdown: "number",
  playerCount: "number",
  prizePool: "number",
  worldRadius: "number",
  roundNumber: "number",
};

const PLAYER_PHASES = ["waiting", "alive", "escaped", "consumed"];
const ROOM_PHASES = ["lobby", "playing", "shrinking", "ended"];

async function serverIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${HTTP_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Poll until our own PlayerState has been decoded out of the players MapSchema. */
function waitForSelf(room: Room<any>, timeoutMs = 10_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      const self = room.state?.players?.get(room.sessionId);
      if (self) {
        clearInterval(tick);
        resolve(self);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(tick);
        reject(new Error("timed out waiting for own PlayerState to decode from the server"));
      }
    }, 50);
  });
}

const SERVER_UP = await serverIsUp();
if (!SERVER_UP) {
  console.warn(`[schema-wire] no Omnivi server reachable at ${HTTP_URL} — integration test skipped`);
}

describe.skipIf(!SERVER_UP)("schema wire compatibility (server v4 encoder → client v3 decoder)", () => {
  let room: Room<any>;
  let self: any;

  beforeAll(async () => {
    const client = new Client(WS_URL);
    room = await client.joinOrCreate<any>("omnivi", {
      name: "wirecheck",
      tier: PROBE_TIER,
      elo: 1000,
      practice: true,
      txHash: "",
      walletAddress: "",
      testnet: false,
    });
    self = await waitForSelf(room);
  }, 30_000);

  afterAll(async () => {
    // Consented leave (close code 1000) so the server does not hold a reconnection slot.
    await room?.leave(true).catch(() => {});
  });

  it("decodes every declared PlayerState field with the right JS type", () => {
    for (const [field, expectedType] of Object.entries(PLAYER_FIELD_TYPES)) {
      expect(self[field], `PlayerState.${field} missing from decoded state`).toBeDefined();
      expect(typeof self[field], `PlayerState.${field} decoded as the wrong type`).toBe(expectedType);
    }
  });

  it("decodes PlayerState numbers to their true server values, not shifted garbage", () => {
    // A field-order or wire-format skew between the v4 encoder and the v3 decoder shows up
    // here first: the values stay numbers but stop matching what the server actually set.
    expect(self.mass).toBe(PROBE_TIER_START_MASS);
    expect(self.buyInMass).toBe(PROBE_TIER_START_MASS);
    expect(self.tier).toBe(PROBE_TIER);
    expect(self.elo).toBe(1000);
    expect(self.kills).toBe(0);
    expect(self.x).toBeGreaterThan(0);
    expect(self.x).toBeLessThan(WORLD_SIZE);
    expect(self.y).toBeGreaterThan(0);
    expect(self.y).toBeLessThan(WORLD_SIZE);
  });

  it("decodes PlayerState strings and booleans to their true server values", () => {
    expect(self.id).toBe(room.sessionId);
    expect(self.name).toBe("wirecheck");
    // OmniviRoom.randomColor() emits HSL, e.g. "hsl(302,80%,60%)".
    expect(self.color).toMatch(/^hsl\(\d{1,3},\d{1,3}%,\d{1,3}%\)$/);
    expect(PLAYER_PHASES).toContain(self.phase);
    expect(self.isBot).toBe(false);
    expect(self.isTestnetTier).toBe(false);
    // Server sets this true in onJoin and clears it once SPAWN_PROTECT_MS elapses.
    expect(typeof self.isSpawnProtected).toBe("boolean");
  });

  it("decodes every declared GameState root field with the right JS type", () => {
    for (const [field, expectedType] of Object.entries(GAME_FIELD_TYPES)) {
      expect(room.state[field], `GameState.${field} missing from decoded state`).toBeDefined();
      expect(typeof room.state[field], `GameState.${field} decoded as the wrong type`).toBe(expectedType);
    }
    expect(ROOM_PHASES).toContain(room.state.phase);
    expect(room.state.worldRadius).toBeGreaterThan(0);
    expect(room.state.worldRadius).toBeLessThanOrEqual(WORLD_SIZE / 2);
    expect(room.state.bhMass).toBeGreaterThanOrEqual(0);
    expect(room.state.roundNumber).toBeGreaterThanOrEqual(0);
    expect(room.state.playerCount).toBeGreaterThanOrEqual(1);
  });

  it("decodes the MapSchema collections NetworkManager binds its callbacks to", () => {
    // Only `players` is guaranteed non-empty here: we are in it. `dust` fills once a round
    // starts and `gravityWells` only when someone casts the ability, and the decoder
    // instantiates a collection lazily on its first entry — so both are legitimately
    // undefined in an idle lobby, and asserting otherwise would test the test, not the wire.
    for (const name of ["players"]) {
      const map = room.state[name];
      expect(map, `GameState.${name} missing from decoded state`).toBeDefined();
      expect(typeof map.get, `GameState.${name} did not decode as a MapSchema`).toBe("function");
      expect(typeof map.forEach).toBe("function");
    }

    // KNOWN CLIENT DEFECT, pinned here deliberately. On colyseus.js 0.16 the collection
    // itself carries no onAdd/onRemove — callbacks are obtained via getStateCallbacks().
    // NetworkManager._attachHandlers still calls `room.state.players.onAdd(...)` directly,
    // which is undefined on this SDK, so its remote-player/dust/gravity-well sync never
    // wires up. This asserts the API that actually exists, so the day NetworkManager is
    // ported to getStateCallbacks it stays covered.
    expect((room.state.players as any).onAdd).toBeUndefined();
    const $ = getStateCallbacks(room);
    expect(typeof $(room.state).players.onAdd).toBe("function");
    expect(typeof $(room.state).players.onRemove).toBe("function");
    expect(room.state.players.size).toBeGreaterThanOrEqual(1);
    expect(room.state.players.get(room.sessionId)).toBeDefined();
  });

  it("keeps decoding incremental patches, not just the initial full state", async () => {
    // Full-state and delta encodes take different paths through the serializer, so a skew
    // can break incremental patches while the first snapshot still looks fine. An idle
    // one-player lobby is genuinely static (nothing to diff), so force a real mutation:
    // a second client joining adds a players entry and bumps playerCount.
    let count = 0;
    room.onStateChange(() => { count++; });

    const other = new Client(WS_URL);
    const otherRoom = await other.joinOrCreate<any>("omnivi", {
      name: "wirecheck2", tier: PROBE_TIER, elo: 1000, practice: true, testnet: false,
    });
    try {
      await new Promise((r) => setTimeout(r, 2000));
      expect(count, "no delta patch decoded after a second client joined").toBeGreaterThanOrEqual(1);
      expect(room.state.players.size).toBeGreaterThanOrEqual(2);
      const peer = room.state.players.get(otherRoom.sessionId);
      expect(peer, "the joining peer never appeared in our decoded players map").toBeDefined();
      expect(peer.name).toBe("wirecheck2");
      expect(peer.mass).toBe(PROBE_TIER_START_MASS);
    } finally {
      await otherRoom.leave(true).catch(() => {});
    }
  }, 15_000);
});

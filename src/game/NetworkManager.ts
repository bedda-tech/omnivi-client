import { Client, Room } from "colyseus.js";

// ─── Player name generation ────────────────────────────────────────────────────
const ADJECTIVES = ["Stellar","Cosmic","Nebula","Solar","Void","Dark","Swift","Silent","Rogue","Quantum"];
const NOUNS      = ["Drifter","Hunter","Nomad","Ranger","Pilot","Seeker","Wanderer","Scout","Voyager","Exile"];
const NAME_KEY   = "omnivi_playername";
const TIER_KEY   = "omnivi_tier";

export function getOrCreatePlayerName(): string {
  const stored = localStorage.getItem(NAME_KEY);
  if (stored) return stored;
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const name = adj + noun;
  localStorage.setItem(NAME_KEY, name);
  return name;
}

/** Persist tier selection across sessions. Default = 1 (Standard). */
export function getStoredTier(): number {
  const v = parseInt(localStorage.getItem(TIER_KEY) ?? "1", 10);
  return [0, 1, 2].includes(v) ? v : 1;
}
export function setStoredTier(tier: number): void {
  localStorage.setItem(TIER_KEY, String(tier));
}

/** Human-readable tier labels and VI cost */
export const TIER_INFO = [
  { label: "Quick",       viCost: 5,   massPerToken: 40 },
  { label: "Standard",    viCost: 25,  massPerToken: 40 },
  { label: "High Roller", viCost: 100, massPerToken: 40 },
] as const;

// ─── Remote player snapshot (what the server tells us about other players) ───
export interface RemotePlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  color: string;
  isThrusting: boolean;
  isEscaping: boolean;
  phase: string;
  tier: number;
  buyInMass: number;
  kills: number;
}

// ─── Server-authoritative game state ─────────────────────────────────────────
export interface ServerGameState {
  phase: string;
  shrinkTimer: number;
  bhMass: number;
  bhX: number;
  bhY: number;
}

// ─── Default server URL (override via VITE_SERVER_URL env var) ────────────────
const DEFAULT_SERVER_URL =
  (import.meta as any).env?.VITE_SERVER_URL ?? "ws://localhost:8000";

export interface ClaimReadyPayload {
  finalMass: string;   // BigInt as decimal string (wei)
  nonce: number;
  signature: string;
  topThreeBonus?: boolean;
  bonusMultiplier?: number;  // 1.5 / 1.25 / 1.1 for top 3 by mass
  massRank?: number;         // 1-based rank among non-consumed players
  killsRank?: number;
}

export interface KillBountyPayload {
  victimName: string;
  victimTier: number;
  bonusMass: number;
}

export class NetworkManager {
  private client: Client;
  private room: Room | null = null;
  private _mySessionId: string = "";
  private _players = new Map<string, RemotePlayer>();
  private _gameState: ServerGameState = {
    phase: "playing",
    shrinkTimer: 90,
    bhMass: 0,
    bhX: 0,
    bhY: 0,
  };
  private _onClaimReady: ((payload: ClaimReadyPayload) => void) | null = null;
  private _onPlayerAdded: ((id: string, rp: RemotePlayer) => void) | null = null;
  private _onPlayerRemoved: ((id: string) => void) | null = null;
  private _onKillBounty: ((payload: KillBountyPayload) => void) | null = null;

  constructor(serverUrl: string = DEFAULT_SERVER_URL) {
    this.client = new Client(serverUrl);
  }

  /** Join (or create) the shared "omnivi" room. Non-throwing — failures are logged. */
  async connect(name: string = "Pilot", tier: number = 1): Promise<void> {
    this.room = await this.client.joinOrCreate<any>("omnivi", { name, tier });
    this._mySessionId = this.room.sessionId;

    // Track remote players (skip our own entry)
    this.room.state.players.onAdd((player: any, sessionId: string) => {
      if (sessionId === this._mySessionId) return;
      const rp = mapPlayer(sessionId, player);
      this._players.set(sessionId, rp);
      this._onPlayerAdded?.(sessionId, rp);
      player.onChange(() => {
        this._players.set(sessionId, mapPlayer(sessionId, player));
      });
    });

    this.room.state.players.onRemove((_player: any, sessionId: string) => {
      this._players.delete(sessionId);
      this._onPlayerRemoved?.(sessionId);
    });

    // Mirror server game state (phase, timers, BH)
    this.room.state.onChange(() => {
      const s = this.room!.state;
      this._gameState = {
        phase: s.phase,
        shrinkTimer: s.shrinkTimer,
        bhMass: s.bhMass,
        bhX: s.bhX,
        bhY: s.bhY,
      };
    });

    // Server sends this after player escapes + SIGNER_PRIVATE_KEY is configured
    this.room.onMessage("claim_ready", (payload: ClaimReadyPayload) => {
      console.log("[Net] Claim ready:", payload);
      this._onClaimReady?.(payload);
    });

    // Kill bounty: server notifies victor of bonus mass after absorbing a player
    this.room.onMessage("kill_bounty", (payload: KillBountyPayload) => {
      console.log("[Net] Kill bounty:", payload);
      this._onKillBounty?.(payload);
    });

    console.log(`[Net] Joined room ${this.room.roomId} as ${this._mySessionId} (tier ${tier})`);
  }

  // ── Outbound messages ───────────────────────────────────────────────────────

  sendPlayerState(
    x: number,
    y: number,
    vx: number,
    vy: number,
    mass: number,
    isThrusting: boolean,
    isEscaping: boolean,
  ): void {
    if (!this.room) return;
    this.room.send("input", { x, y, vx, vy, mass, isThrusting, isEscaping });
  }

  /** Notify server that we absorbed another player (victimId = their sessionId). */
  sendAbsorbPlayer(victimId: string): void {
    this.room?.send("absorb_player", { victimId });
  }

  sendEscaped(walletAddress?: string): void {
    this.room?.send("escaped", walletAddress ? { walletAddress } : {});
  }

  sendConsumed(): void {
    this.room?.send("consumed");
  }

  // ── Callbacks ───────────────────────────────────────────────────────────────

  /** Register a callback to receive signed claim data after escaping. */
  onClaimReady(cb: (payload: ClaimReadyPayload) => void): void {
    this._onClaimReady = cb;
  }

  onPlayerAdded(cb: (id: string, rp: RemotePlayer) => void): void {
    this._onPlayerAdded = cb;
  }

  onPlayerRemoved(cb: (id: string) => void): void {
    this._onPlayerRemoved = cb;
  }

  /** Called when server confirms a kill bounty for this player. */
  onKillBounty(cb: (payload: KillBountyPayload) => void): void {
    this._onKillBounty = cb;
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  get mySessionId(): string { return this._mySessionId; }
  get otherPlayers(): Map<string, RemotePlayer> { return this._players; }
  get gameState(): ServerGameState { return this._gameState; }
  get connected(): boolean { return this.room !== null; }

  disconnect(): void {
    this.room?.leave();
    this.room = null;
    this._players.clear();
  }
}

function mapPlayer(sessionId: string, p: any): RemotePlayer {
  return {
    id:          sessionId,
    name:        p.name        ?? "Pilot",
    x:           p.x,
    y:           p.y,
    vx:          p.vx          ?? 0,
    vy:          p.vy          ?? 0,
    mass:        p.mass,
    color:       p.color       ?? "#ffffff",
    isThrusting: p.isThrusting ?? false,
    isEscaping:  p.isEscaping  ?? false,
    phase:       p.phase       ?? "alive",
    tier:        p.tier        ?? 1,
    buyInMass:   p.buyInMass   ?? 1000,
    kills:       p.kills       ?? 0,
  };
}

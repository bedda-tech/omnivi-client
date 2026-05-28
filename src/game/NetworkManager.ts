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

/** Human-readable tier labels and VI buy-in (mass = VI, no conversion) */
export const TIER_INFO = [
  { label: "Quick",       viCost: 200 },
  { label: "Standard",    viCost: 1000 },
  { label: "High Roller", viCost: 4000 },
] as const;

// ─── VI Balance (simulated wallet) ───────────────────────────────────────────
const VI_BALANCE_KEY = "omnivi_vi_balance";
export const VI_BALANCE_START = 10_000; // VI given to new players on first launch

export function getViBalance(): number {
  const v = parseInt(localStorage.getItem(VI_BALANCE_KEY) ?? String(VI_BALANCE_START), 10);
  return isNaN(v) ? VI_BALANCE_START : v;
}
export function setViBalance(n: number): void {
  localStorage.setItem(VI_BALANCE_KEY, String(Math.max(0, Math.round(n))));
}
/** Deduct buy-in cost for the given tier. Call at round start. */
export function deductBuyIn(tier: number): void {
  setViBalance(getViBalance() - TIER_INFO[tier].viCost);
}
/** Credit a payout to the player's balance. Call on escape/win. */
export function creditPayout(amount: number): void {
  setViBalance(getViBalance() + Math.max(0, Math.round(amount)));
}

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
  prizePool: number;
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

export interface RoundResult {
  id:        string;
  name:      string;
  mass:      number;
  kills:     number;
  phase:     string;
  tier:      number;
  buyInMass: number;
}

export interface LobbyState {
  phase:          string;
  lobbyCountdown: number;
  playerCount:    number;
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
    prizePool: 0,
  };
  private _onClaimReady: ((payload: ClaimReadyPayload) => void) | null = null;
  private _onPlayerAdded: ((id: string, rp: RemotePlayer) => void) | null = null;
  private _onPlayerRemoved: ((id: string) => void) | null = null;
  private _onKillBounty: ((payload: KillBountyPayload) => void) | null = null;
  /** Fires whenever the server broadcasts a new authoritative mass for the local player. */
  private _onSelfMassUpdate: ((mass: number) => void) | null = null;
  /** Fires when server forcibly marks this player as BH-consumed (authoritative death). */
  private _onBhConsumed: (() => void) | null = null;
  private _onRoundStarted: (() => void) | null = null;
  private _onRoundEnded: ((results: RoundResult[]) => void) | null = null;
  private _onLobbyState: ((state: LobbyState) => void) | null = null;
  private _onLobbyReset: (() => void) | null = null;
  /** Fires when server spawns a new dust particle or forms a server asteroid. */
  private _onServerDustAdded: ((id: string, x: number, y: number, mass: number, kind: string) => void) | null = null;
  /** Fires when a server dust particle is absorbed (by any player) or expires. */
  private _onServerDustRemoved: ((id: string) => void) | null = null;
  /** Last server-authoritative mass for the local player (0 = not yet received). */
  private _serverMass: number = 0;

  constructor(serverUrl: string = DEFAULT_SERVER_URL) {
    this.client = new Client(serverUrl);
  }

  /** Join (or create) the shared "omnivi" room. Non-throwing — failures are logged. */
  async connect(name: string = "Pilot", tier: number = 1, elo: number = 1000, practice: boolean = false): Promise<void> {
    this.room = await this.client.joinOrCreate<any>("omnivi", { name, tier, elo, practice });
    this._mySessionId = this.room.sessionId;

    // Track remote players; also track own player for server mass corrections
    this.room.state.players.onAdd((player: any, sessionId: string) => {
      if (sessionId === this._mySessionId) {
        // Subscribe to own player state — used for server-authoritative mass reconciliation
        this._serverMass = player.mass;
        player.onChange(() => {
          if (player.mass !== this._serverMass) {
            this._serverMass = player.mass;
            this._onSelfMassUpdate?.(player.mass);
          }
        });
        return;
      }
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

    // Sync server-managed dust particles (thrust exhaust dust for mass credit)
    this.room.state.dust.onAdd((d: any, id: string) => {
      this._onServerDustAdded?.(id, d.x, d.y, d.mass, d.kind ?? "dust");
    });
    this.room.state.dust.onRemove((_d: any, id: string) => {
      this._onServerDustRemoved?.(id);
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

    // Server-authoritative BH consumption: server detected player inside BH
    this.room.onMessage("bh_consumed", () => {
      console.log("[Net] Server BH consumed this player");
      this._onBhConsumed?.();
    });

    // Lobby/round lifecycle messages
    this.room.onMessage("round_start", () => {
      console.log("[Net] Round started");
      this._onRoundStarted?.();
    });

    this.room.onMessage("round_ended", (payload: { results: RoundResult[] }) => {
      console.log("[Net] Round ended, results:", payload.results.length);
      this._onRoundEnded?.(payload.results);
    });

    this.room.onMessage("room_phase", (payload: { phase: string; lobbyCountdown: number }) => {
      this._onLobbyState?.({
        phase: payload.phase,
        lobbyCountdown: payload.lobbyCountdown,
        playerCount: this.room!.state.playerCount ?? 0,
      });
    });

    this.room.onMessage("lobby_reset", () => {
      console.log("[Net] Lobby reset for next round");
      this._onLobbyReset?.();
    });

    // Mirror lobby state changes
    this.room.state.onChange(() => {
      const s = this.room!.state;
      this._gameState = {
        phase: s.phase,
        shrinkTimer: s.shrinkTimer,
        bhMass: s.bhMass,
        bhX: s.bhX,
        bhY: s.bhY,
        prizePool: s.prizePool ?? 0,
      };
      if (s.phase === "lobby" || s.phase === "ended") {
        this._onLobbyState?.({
          phase: s.phase,
          lobbyCountdown: s.lobbyCountdown ?? 0,
          playerCount: s.playerCount ?? 0,
        });
      }
    });

    console.log(`[Net] Joined room ${this.room.roomId} as ${this._mySessionId} (tier ${tier})`);
  }

  // ── Outbound messages ───────────────────────────────────────────────────────

  sendPlayerState(
    x: number,
    y: number,
    vx: number,
    vy: number,
    isThrusting: boolean,
    isEscaping: boolean,
  ): void {
    if (!this.room) return;
    this.room.send("input", { x, y, vx, vy, isThrusting, isEscaping });
  }

  /** Notify server that we absorbed another player (victimId = their sessionId). */
  sendAbsorbPlayer(victimId: string): void {
    this.room?.send("absorb_player", { victimId });
  }

  /**
   * Notify server of a mass absorption event so it can update its authoritative mass.
   * kind: 'dust' | 'asteroid' | 'bot'
   * gained: mass absorbed (must be > 0)
   */
  sendAbsorb(kind: "dust" | "asteroid" | "bot", gained: number): void {
    if (!this.room || gained <= 0) return;
    this.room.send("absorb", { kind, gained });
  }

  /**
   * Notify server that we activated an ability so it can deduct mass server-side.
   * Server recomputes the actual cost from its own mass value.
   */
  sendUseAbility(type: "boost" | "shield" | "eject"): void {
    this.room?.send("use_ability", { type });
  }

  /**
   * Notify server that we absorbed a server-registered dust particle.
   * Server validates proximity and credits mass. Only call with a valid server dustId.
   */
  sendAbsorbDust(dustId: string): void {
    this.room?.send("absorb_dust", { dustId });
  }

  sendEscaped(walletAddress?: string): void {
    this.room?.send("escaped", walletAddress ? { walletAddress } : {});
  }

  sendEscapeStart(): void {
    this.room?.send("escape_start", {});
  }

  sendEscapeCancel(): void {
    this.room?.send("escape_cancel", {});
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

  /**
   * Called whenever the server broadcasts a new authoritative mass for the local player.
   * Use this to apply server corrections to the local simulation.
   */
  onSelfMassUpdate(cb: (mass: number) => void): void {
    this._onSelfMassUpdate = cb;
  }

  /** Called when server signals round is starting (lobby → playing). */
  onRoundStarted(cb: () => void): void {
    this._onRoundStarted = cb;
  }

  /** Called when all players are consumed/escaped — provides final rankings. */
  onRoundEnded(cb: (results: RoundResult[]) => void): void {
    this._onRoundEnded = cb;
  }

  /** Called whenever lobby state changes (countdown, player count). */
  onLobbyState(cb: (state: LobbyState) => void): void {
    this._onLobbyState = cb;
  }

  /** Called when server resets lobby for next round. */
  onLobbyReset(cb: () => void): void {
    this._onLobbyReset = cb;
  }

  /** Called when server spawns a dust particle or forms an asteroid. kind = "dust" | "asteroid". */
  onServerDustAdded(cb: (id: string, x: number, y: number, mass: number, kind: string) => void): void {
    this._onServerDustAdded = cb;
  }

  /** Called when a server dust particle is absorbed or expires. Mark the local copy inactive. */
  onServerDustRemoved(cb: (id: string) => void): void {
    this._onServerDustRemoved = cb;
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  get mySessionId(): string { return this._mySessionId; }
  get otherPlayers(): Map<string, RemotePlayer> { return this._players; }
  get gameState(): ServerGameState { return this._gameState; }
  get connected(): boolean { return this.room !== null; }
  /** Last server-authoritative mass for the local player. 0 if not yet received. */
  get serverMass(): number { return this._serverMass; }

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
